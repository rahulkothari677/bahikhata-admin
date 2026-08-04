import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * A bulk plan change must WRITE A SUBSCRIPTION, not just set user.plan.
 *
 * WHY (audit 2026-08-03): it set `user.plan` alone. The main app's
 * getUserPlan() treats `user.plan` as a CLAIM to be verified — for 'pro' and
 * 'elite' it looks for an active, non-expired Subscription row and returns
 * 'free' when there is none (main app, src/lib/usage-limits.ts, the V26 F3
 * expiry fix).
 *
 * So bulk-upgrading 100 shopkeepers reported "100 users changed to pro" and
 * upgraded nobody. The admin saw success. The users stayed free. Nothing
 * anywhere reported a problem, because each half was correct on its own — the
 * defect only exists in the space between the two repos.
 *
 * That gap is exactly why this test lives HERE. It was originally written in
 * the main app's suite, reading this file across a sibling checkout. It passed
 * on a laptop with both repos side by side and could never pass in CI, which
 * checks out one repo — so it broke the main app's CI on every push while
 * proving nothing about this one. A cross-repo guarantee has to be enforced in
 * the repo that can actually break it.
 *
 * Source-level assertions rather than behavioural ones: the failure mode is a
 * missing write, and the cheapest honest way to catch a write that isn't there
 * is to require it in the source. The main app holds the matching test for its
 * own half (referral rewards and the welcome trial).
 */

const ROUTE = path.resolve(__dirname, '../src/app/api/admin/bulk/route.ts')

function read(): string {
  return fs.readFileSync(ROUTE, 'utf8').replace(/\r\n/g, '\n')
}

describe('bulk plan change actually grants the plan', () => {
  it('has the route this test is about', () => {
    // Guards against the test quietly becoming vacuous if the file moves.
    expect(fs.existsSync(ROUTE)).toBe(true)
  })

  it('creates Subscription rows, without which the upgrade is cosmetic', () => {
    const src = read()
    expect(src).toMatch(/tx\.subscription\.createMany/)
    expect(src).toMatch(/paymentMode: 'admin_grant'/)
  })

  it('expires superseded grants so the user row and subscriptions agree', () => {
    const src = read()
    expect(src).toMatch(/tx\.subscription\.updateMany/)
    expect(src).toMatch(/status: 'expired'/)
  })

  it('does it in one transaction — a partial apply leaves the two disagreeing', () => {
    expect(read()).toMatch(/db\.\$transaction\(async \(tx\)/)
  })

  it('supplies an explicit Subscription id — the column has no DB default', () => {
    expect(read()).toMatch(/id: `adminbulk_/)
  })
})
