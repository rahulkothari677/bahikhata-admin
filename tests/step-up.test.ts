import { describe, it, expect } from 'vitest'
import { isStepUpValid, stepUpRemainingSeconds, STEP_UP_WINDOW_MS } from '../src/lib/step-up'
import { ROUTE_POLICY } from '../src/lib/route-policy'

/**
 * Guards for step-up authentication.
 *
 * WHY (audit 2026-07-27): ROUTE_POLICY marked 11 routes `stepUp: true` —
 * impersonation, data exports, the SQL console, admin-user management, bulk
 * operations. Nothing read the flag. It was documentation.
 *
 * An admin session lasts an hour, so an unlocked laptop, a borrowed browser or
 * a stolen session cookie was enough to impersonate a shopkeeper or export the
 * database. Being logged in is not the same as being present, and on those
 * routes the difference is the whole control.
 */

const now = new Date('2026-07-27T12:00:00.000Z')

describe('step-up window', () => {
  it('rejects when no step-up has ever happened', () => {
    // The default must be DENY. A null timestamp meaning "allowed" would make
    // the control fail open for every operator who never verified.
    expect(isStepUpValid(null, now)).toBe(false)
    expect(isStepUpValid(undefined, now)).toBe(false)
  })

  it('accepts a fresh verification', () => {
    expect(isStepUpValid(new Date(now.getTime() - 60_000), now)).toBe(true)
  })

  it('rejects once the window has passed', () => {
    expect(isStepUpValid(new Date(now.getTime() - STEP_UP_WINDOW_MS - 1), now)).toBe(false)
  })

  it('is correct exactly at the boundary', () => {
    // Off-by-one here either locks people out a second early or grants an
    // extra second of privilege. Exactly at the limit is still valid.
    expect(isStepUpValid(new Date(now.getTime() - STEP_UP_WINDOW_MS), now)).toBe(true)
    expect(isStepUpValid(new Date(now.getTime() - STEP_UP_WINDOW_MS - 1), now)).toBe(false)
  })

  it('rejects a timestamp in the FUTURE', () => {
    // Clock skew or a tampered row must not grant an unbounded window — a
    // far-future value would otherwise stay "valid" indefinitely.
    expect(isStepUpValid(new Date(now.getTime() + 60_000), now)).toBe(false)
    expect(isStepUpValid(new Date('2030-01-01'), now)).toBe(false)
  })

  it('stays short — it is not a second session', () => {
    // If this grows to hours it stops proving presence, which is the only
    // thing it exists to prove.
    expect(STEP_UP_WINDOW_MS).toBeLessThanOrEqual(15 * 60 * 1000)
  })
})

describe('remaining seconds', () => {
  it('is 0 with no grant', () => {
    expect(stepUpRemainingSeconds(null, now)).toBe(0)
  })

  it('counts down', () => {
    const verified = new Date(now.getTime() - 2 * 60_000)
    expect(stepUpRemainingSeconds(verified, now)).toBe(8 * 60)
  })

  it('is 0 once expired, never negative', () => {
    expect(stepUpRemainingSeconds(new Date(now.getTime() - 60 * 60_000), now)).toBe(0)
  })
})

describe('policy coverage', () => {
  it('the most dangerous routes require step-up', () => {
    // Impersonation, exports and the SQL console reach a shopkeeper's actual
    // books. These are exactly the actions where a walked-away laptop matters.
    for (const key of [
      'admin/impersonate',
      'admin/data-exports/generate',
      'admin/database/query',
      'admin/admin-users',
      'admin/bulk',
    ]) {
      expect(ROUTE_POLICY[key]?.stepUp, `${key} must require step-up`).toBe(true)
    }
  })

  it('read-only dashboards do NOT require step-up', () => {
    // Over-applying it would make the panel unusable and get the control
    // switched off, which is the usual fate of security that gets in the way.
    for (const key of ['admin/overview', 'admin/users', 'admin/activity', 'admin/revenue']) {
      expect(ROUTE_POLICY[key]?.stepUp, `${key} should not require step-up`).toBeFalsy()
    }
  })
})
