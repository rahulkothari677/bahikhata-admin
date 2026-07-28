/**
 * STEP-UP AUTHENTICATION — proving the operator is still at the keyboard.
 *
 * WHY (audit 2026-07-27): ROUTE_POLICY marks 11 routes `stepUp: true` —
 * impersonation, data exports, the SQL console, admin-user management, bulk
 * operations. That flag was documentation. Nothing read it.
 *
 * An admin session lasts an hour. An unlocked laptop, a borrowed browser or a
 * stolen session cookie is therefore enough to impersonate a shopkeeper or
 * export the database. Being logged in is not the same as being present, and
 * for those routes the difference matters.
 *
 * Re-entering a TOTP code proves possession of the second factor NOW. The
 * grant lasts minutes, so an investigation can proceed without re-prompting on
 * every click, while a walked-away laptop goes cold quickly.
 *
 * This is NOT a second session and must never be extended into one. If the
 * window grows to hours it stops proving anything.
 */

/**
 * How long a step-up lasts. Long enough to complete one piece of work —
 * open an export, run a few SQL queries, resolve a support case — short enough
 * that an abandoned session is not still privileged when someone else sits down.
 */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

export function isStepUpValid(
  verifiedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!verifiedAt) return false
  const age = now.getTime() - verifiedAt.getTime()
  // A timestamp in the FUTURE is rejected too. Clock skew or a tampered row
  // must not grant an unbounded window.
  if (age < 0) return false
  return age <= STEP_UP_WINDOW_MS
}

/** Seconds until the current grant expires; 0 if there is none. */
export function stepUpRemainingSeconds(
  verifiedAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!isStepUpValid(verifiedAt, now)) return 0
  const remaining = STEP_UP_WINDOW_MS - (now.getTime() - verifiedAt!.getTime())
  return Math.max(0, Math.floor(remaining / 1000))
}
