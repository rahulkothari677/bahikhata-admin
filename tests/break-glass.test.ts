import { describe, it, expect } from 'vitest'
import {
  validateActivation,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  MIN_REASON_LENGTH,
} from '../src/lib/break-glass'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * §C4 — break-glass emergency access.
 *
 * It exists BECAUSE the other controls are strict: roles re-read per request,
 * step-up TOTP, revocable sessions. Strictness creates a new failure mode —
 * being locked out of your own product mid-incident. The design requirement is
 * that using it is SAFE but IMPOSSIBLE TO HIDE.
 *
 * The rules below are the "impossible to hide" half. They are pure functions
 * precisely so the ceiling cannot be bypassed by a caller passing its own
 * number.
 */

describe('a break-glass needs a reason someone can act on later', () => {
  it('refuses an empty reason', () => {
    const r = validateActivation({ reason: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('REASON_REQUIRED')
  })

  it('refuses a token reason like "x"', () => {
    // Worse than none: it looks like process was followed.
    expect(validateActivation({ reason: 'x' }).ok).toBe(false)
    expect(validateActivation({ reason: 'urgent' }).ok).toBe(false)
  })

  it('refuses whitespace padded to look long enough', () => {
    expect(validateActivation({ reason: '   ' + ' '.repeat(40) }).ok).toBe(false)
  })

  it('accepts a real explanation', () => {
    const r = validateActivation({ reason: 'Payment webhook is down and I cannot reach the queue through the normal panel' })
    expect(r.ok).toBe(true)
  })

  it('explains WHY the reason matters, not just that it is required', () => {
    const r = validateActivation({ reason: 'x' })
    if (!r.ok) expect(r.error.message).toMatch(/months later|legitimate/i)
  })
})

describe('the 60-minute ceiling cannot be argued with', () => {
  it('defaults to the ceiling when unspecified', () => {
    const r = validateActivation({ reason: 'a'.repeat(MIN_REASON_LENGTH) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.durationMinutes).toBe(MAX_DURATION_MINUTES)
  })

  it('REFUSES an over-long request instead of silently clamping it', () => {
    // Silently granting 60 when 600 was asked for teaches people the field does
    // not matter, and the next person believes they had ten hours.
    const r = validateActivation({ reason: 'a'.repeat(MIN_REASON_LENGTH), durationMinutes: 600 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_DURATION')
  })

  it('refuses a duration below the floor', () => {
    expect(validateActivation({ reason: 'a'.repeat(MIN_REASON_LENGTH), durationMinutes: 1 }).ok).toBe(false)
  })

  it('accepts the exact boundaries', () => {
    const reason = 'a'.repeat(MIN_REASON_LENGTH)
    expect(validateActivation({ reason, durationMinutes: MIN_DURATION_MINUTES }).ok).toBe(true)
    expect(validateActivation({ reason, durationMinutes: MAX_DURATION_MINUTES }).ok).toBe(true)
  })

  it('rejects non-integer and nonsense durations', () => {
    const reason = 'a'.repeat(MIN_REASON_LENGTH)
    for (const bad of [30.5, NaN, Infinity, 'sixty', {}]) {
      expect(validateActivation({ reason, durationMinutes: bad as never }).ok, String(bad)).toBe(false)
    }
  })

  it('says there is no renewal, so nobody goes looking for the button', () => {
    const r = validateActivation({ reason: 'a'.repeat(MIN_REASON_LENGTH), durationMinutes: 600 })
    if (!r.ok) expect(r.error.message).toMatch(/no renewal/i)
  })
})

describe('the activation route is built so it cannot be used quietly', () => {
  const src = readFileSync(
    join(__dirname, '..', 'src', 'app', 'api', 'admin', 'break-glass', 'route.ts'),
    'utf8',
  )

  it('is founder-only', () => {
    expect(src).toMatch(/ctx\.role !== 'founder'/)
  })

  it('demands a FRESH TOTP, not the one proved at login', () => {
    // Break-glass is exactly what someone holding a stolen session reaches for,
    // and that session already carries whatever factor was proved at sign-in.
    expect(src).toMatch(/authenticator\.verify/)
    expect(src).toMatch(/checkTotpRate/)
  })

  it('rate-limits the code, like every other TOTP site', () => {
    const verifies = (src.match(/authenticator\.verify\(/g) ?? []).length
    const guards = (src.match(/checkTotpRate\(/g) ?? []).length
    expect(guards).toBeGreaterThanOrEqual(verifies)
  })

  it('refuses a second overlapping session', () => {
    // Two at once makes "who was in, under what reason, when" ambiguous — the
    // only question this table exists to answer.
    expect(src).toMatch(/ALREADY_ACTIVE/)
  })

  it('audits the activation, and marks self-approved ones as such', () => {
    expect(src).toMatch(/break_glass_activated/)
    expect(src).toMatch(/SELF-APPROVED/)
  })

  it('audits a FAILED activation too', () => {
    // Someone at a privileged session who cannot produce the second factor is
    // the single most interesting event this panel can record.
    expect(src).toMatch(/break_glass_failed/)
  })

  it('does not silently pass when the founder has no TOTP set up', () => {
    expect(src).toMatch(/TOTP_NOT_CONFIGURED/)
    expect(src).toMatch(/RUNBOOK-lockout/)
  })
})

describe('revoking is deliberately the easiest thing here', () => {
  const src = readFileSync(
    join(__dirname, '..', 'src', 'app', 'api', 'admin', 'break-glass', 'revoke', 'route.ts'),
    'utf8',
  )

  it('needs no TOTP and no reason', () => {
    // Making it harder than activation would leave emergency windows open out
    // of inconvenience — the opposite of the point.
    expect(src).not.toMatch(/authenticator\.verify/)
    expect(src).not.toMatch(/REASON_REQUIRED/)
  })

  it('uses a conditional update so two founders cannot both claim the close', () => {
    expect(src).toMatch(/updateMany/)
    expect(src).toMatch(/revokedAt: null/)
    expect(src).toMatch(/result\.count === 0/)
  })

  it('treats "nothing to revoke" as success, not an error', () => {
    // An operator hitting this twice in a panic should not see a red screen.
    expect(src).toMatch(/alreadyClosed/)
  })

  it('audits the revocation with the original reason', () => {
    expect(src).toMatch(/break_glass_revoked/)
    expect(src).toMatch(/active\.reason/)
  })
})

describe('both routes are registered in the policy', () => {
  // withAdmin fails CLOSED on an unregistered route, so a missing entry would
  // 500 rather than expose anything — but it would 500 during an emergency,
  // which is the worst possible moment to discover it.
  const policy = readFileSync(join(__dirname, '..', 'src', 'lib', 'route-policy.ts'), 'utf8')

  it('admin/break-glass has a policy entry', () => {
    expect(policy).toMatch(/'admin\/break-glass':/)
  })

  it('admin/break-glass/revoke has a policy entry', () => {
    expect(policy).toMatch(/'admin\/break-glass\/revoke':/)
  })

  it('neither requires stepUp, which would be unsatisfiable here', () => {
    const block = policy.slice(policy.indexOf("'admin/break-glass':"), policy.indexOf("'admin/step-up':"))
    expect(block).not.toMatch(/stepUp:\s*true/)
  })
})
