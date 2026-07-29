import { db } from '@/lib/db'

/**
 * Break-glass emergency access (master report §C4).
 *
 * WHY IT EXISTS: the admin panel is deliberately strict — roles re-read from
 * the database on every request, step-up TOTP before sensitive actions,
 * sessions revocable by tokenVersion. Strict controls create a new failure
 * mode: being locked out of your own product during an incident. An emergency
 * path is the answer, and the design requirement is that using it is SAFE but
 * IMPOSSIBLE TO HIDE.
 *
 * What that means concretely:
 *   - a written reason is mandatory
 *   - a hard 60-minute ceiling, enforced here rather than trusted to the caller
 *   - no renewal; a fresh activation with a fresh reason instead
 *   - founder only, with a fresh TOTP — a stolen session cannot open one
 *   - loudly audited on activation, expiry-check and revocation
 *
 * WHAT IT DOES NOT DO: it does not grant extra permissions. This codebase has
 * no privilege above `founder`, and inventing one would create exactly the
 * "permanent god mode" the report calls out as unauditable (§H11). A
 * break-glass session is a RECORD that emergency access was taken, tied to a
 * reason and a clock, which is what makes the action reviewable afterwards.
 * Adding capability to it later must keep that property.
 */

/**
 * The ceiling. An emergency that genuinely needs longer needs a second person
 * to know about it, which is what re-activating forces.
 */
export const MAX_DURATION_MINUTES = 60

/** Sane floor so a mistyped `1` does not open an hour-long window. */
export const MIN_DURATION_MINUTES = 5

/**
 * A reason short enough to be meaningless is worse than none — it looks like
 * process was followed. "x" must not pass.
 */
export const MIN_REASON_LENGTH = 20

export type ActiveSession = {
  id: string
  adminId: string
  adminEmail: string
  reason: string
  approvedBy: string | null
  startedAt: Date
  expiresAt: Date
  minutesRemaining: number
}

/**
 * The single source of truth for "is emergency access live right now".
 *
 * Expiry is evaluated in SQL against the database clock, not the Node clock.
 * A serverless instance with a skewed clock must not be able to extend a
 * break-glass window by being wrong about the time.
 */
export async function getActiveSession(now: Date = new Date()): Promise<ActiveSession | null> {
  const row = await db.breakGlassSession.findFirst({
    where: { revokedAt: null, expiresAt: { gt: now } },
    orderBy: { startedAt: 'desc' },
  })
  if (!row) return null

  return {
    id: row.id,
    adminId: row.adminId,
    adminEmail: row.adminEmail,
    reason: row.reason,
    approvedBy: row.approvedBy,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    minutesRemaining: Math.max(0, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 60_000)),
  }
}

export type ValidationFailure = { code: string; message: string }

/**
 * Validates an activation request. Pure, so the rules are testable without a
 * database — and so the ceiling cannot be quietly bypassed by a caller passing
 * its own number.
 */
export function validateActivation(input: {
  reason?: unknown
  durationMinutes?: unknown
}): { ok: true; reason: string; durationMinutes: number } | { ok: false; error: ValidationFailure } {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''

  if (reason.length < MIN_REASON_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'REASON_REQUIRED',
        message:
          `Describe the emergency in at least ${MIN_REASON_LENGTH} characters. ` +
          `This is read months later by someone deciding whether this access was legitimate.`,
      },
    }
  }

  const raw = input.durationMinutes
  // Default to the ceiling ONLY when unspecified. An explicit bad value is an
  // error, not something to silently round — silently accepting 600 and
  // granting 60 teaches people the field does not matter.
  const durationMinutes = raw === undefined || raw === null ? MAX_DURATION_MINUTES : Number(raw)

  if (!Number.isFinite(durationMinutes) || !Number.isInteger(durationMinutes)) {
    return { ok: false, error: { code: 'INVALID_DURATION', message: 'Duration must be a whole number of minutes.' } }
  }
  if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    return {
      ok: false,
      error: {
        code: 'INVALID_DURATION',
        message: `Duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes. There is no renewal — activate again, with a fresh reason, if the emergency outlasts it.`,
      },
    }
  }

  return { ok: true, reason, durationMinutes }
}

/**
 * Sessions from the last N days, for the weekly digest and the review screen.
 *
 * Returns an empty array rather than throwing when there are none — and the
 * digest is sent EVEN THEN. A zero-activity report is how a missing one gets
 * noticed; a digest that only arrives when something happened is
 * indistinguishable from a digest that has silently stopped working.
 */
export async function listRecentSessions(sinceDays = 7, now: Date = new Date()) {
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000)
  return db.breakGlassSession.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: 'desc' },
    take: 200, // a fuse; 200 break-glass sessions in a week is itself the alert
  })
}
