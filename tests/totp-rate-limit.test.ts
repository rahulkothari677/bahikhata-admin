import { describe, it, expect, beforeEach } from 'vitest'
import { checkTotpRate, resetTotpRate, isRateLimitBackedByRedis } from '../src/lib/admin-rate-limit'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Guards for TOTP brute-force protection.
 *
 * WHY (audit 2026-07-28): second-factor verification had NO rate limit at all.
 * A TOTP code is six digits — one million possibilities — and with the ±1 step
 * drift tolerance each code stays valid roughly 90 seconds. Unlimited guessing
 * turns "something you have" into "something you can guess", which removes the
 * entire benefit of the second factor.
 *
 * Three places verify a code, and the DELETE one is the worst: it DISABLES 2FA.
 * Brute-forcing that converts a temporarily stolen session into permanent
 * access with the second factor stripped off the account.
 */

describe('TOTP rate limiting', () => {
  beforeEach(async () => {
    await resetTotpRate('admin-under-test')
  })

  it('allows a genuine operator who mistypes a couple of times', () => {
    // Over-tightening this would lock real people out of their own panel,
    // which gets the control removed.
    return (async () => {
      for (let i = 0; i < 5; i++) {
        const r = await checkTotpRate('admin-under-test')
        expect(r.success, `attempt ${i + 1} should be allowed`).toBe(true)
      }
    })()
  })

  it('blocks the sixth attempt', async () => {
    for (let i = 0; i < 5; i++) await checkTotpRate('admin-under-test')
    const blocked = await checkTotpRate('admin-under-test')
    expect(blocked.success).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('tells the caller how long to wait', async () => {
    for (let i = 0; i < 6; i++) await checkTotpRate('admin-under-test')
    const blocked = await checkTotpRate('admin-under-test')
    // A block with no timeframe just looks broken, and the operator retries
    // forever instead of waiting.
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(5 * 60)
  })

  it('counts each admin separately', async () => {
    // One operator fat-fingering their code must not lock out another.
    for (let i = 0; i < 6; i++) await checkTotpRate('admin-a')
    const other = await checkTotpRate('admin-b')
    expect(other.success).toBe(true)
    await resetTotpRate('admin-a')
    await resetTotpRate('admin-b')
  })

  it('clears on success, so a mistype does not follow you around', async () => {
    for (let i = 0; i < 4; i++) await checkTotpRate('admin-under-test')
    await resetTotpRate('admin-under-test')
    const after = await checkTotpRate('admin-under-test')
    expect(after.success).toBe(true)
  })

  it('is keyed independently from the login limiter', () => {
    // Different prefixes. Exhausting one must not lock the other, or a user
    // who mistypes their password five times also loses the ability to
    // complete a step-up.
    const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'admin-rate-limit.ts'), 'utf8')
    expect(src).toMatch(/prefix:\s*'admin-login'/)
    expect(src).toMatch(/prefix:\s*'admin-totp'/)
  })
})

describe('every TOTP verification site is rate-limited', () => {
  // A limiter that exists but is not called at one of the three sites protects
  // nothing — an attacker simply uses that one.
  const sites: Array<[string, string[]]> = [
    ['admin/2fa/route.ts', ['src/app/api/admin/2fa/route.ts']],
    ['admin/step-up/route.ts', ['src/app/api/admin/step-up/route.ts']],
  ]

  for (const [label, path] of sites) {
    it(`${label} calls checkTotpRate before verifying`, () => {
      const src = readFileSync(join(__dirname, '..', ...path[0].split('/')), 'utf8')
      const verifyCount = (src.match(/authenticator\.verify\(/g) ?? []).length
      const guardCount = (src.match(/checkTotpRate\(/g) ?? []).length
      expect(verifyCount).toBeGreaterThan(0)
      expect(
        guardCount,
        `${label} verifies a code ${verifyCount} time(s) but guards ${guardCount} — every verify needs a guard`,
      ).toBeGreaterThanOrEqual(verifyCount)
    })
  }
})

describe('production configuration', () => {
  it('exposes whether Redis actually backs the limit', () => {
    // On Vercel each instance holds its own in-memory Map, so without Redis
    // the effective limit is (max x instances) and resets on every cold start
    // — close to no limit at all. This must be VISIBLE, not assumed.
    expect(typeof isRateLimitBackedByRedis()).toBe('boolean')
  })
})
