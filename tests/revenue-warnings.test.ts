import { describe, it, expect } from 'vitest'
import { buildRevenueWarnings } from '../src/lib/financial-reports'

/**
 * Guards for the P&L revenue warnings.
 *
 * WHY (audit 2026-07-26, found by driving the running app, not by reading):
 * the P&L reported
 *     revenue: { subscriptionRevenue: 0, totalRevenue: 0 }
 *     costs:   { paymentGatewayFees: 109.96 }
 * simultaneously. The fees are 2% of cash received, so the report was charging
 * fees on Rs.5,498 of cash while declaring Rs.0 of revenue.
 *
 * Root cause: recognised revenue is read from RevenueSchedule, but cash is read
 * from Subscription. RevenueSchedule rows are written in exactly one place and
 * that code path was reachable ONLY by a human clicking "recompute" in the UI —
 * revenue-recognition was absent from both CRON_PATHS and the cron workflow.
 * So the financial report showed Rs.0 revenue indefinitely.
 *
 * Two distinct situations produce a zero, and conflating them is the trap:
 *   (a) the job never ran            -> the number is UNCOMPUTED
 *   (b) the job ran, nothing earned  -> the number is CORRECT (deferred revenue)
 *
 * This test imports the real exported function used by the route — not a
 * reimplementation — because this repo's sibling once shipped 31 "behavioural
 * tests" that validated helper files nothing imported.
 */
describe('P&L revenue warnings', () => {
  it('is silent when revenue was recognised normally', () => {
    expect(buildRevenueWarnings(5000, 5000, 12)).toEqual([])
  })

  it('is silent when there is no cash and no revenue', () => {
    // A genuinely empty period is not a defect.
    expect(buildRevenueWarnings(0, 0, 0)).toEqual([])
  })

  it('says UNCOMPUTED when cash exists and the schedule was never built', () => {
    const [warning] = buildRevenueWarnings(0, 5498, 0)
    expect(warning).toMatch(/never\s+been built/i)
    expect(warning).toMatch(/UNCOMPUTED/)
    expect(warning).toMatch(/recompute/)
  })

  it('says DEFERRED when the schedule exists but nothing is earned yet', () => {
    // The real local scenario: two subscriptions started today, recompute ran
    // and created 13 rows, all of them `current`/`pending`. Rs.0 recognised is
    // correct accrual accounting here and must NOT be reported as a failure.
    const [warning] = buildRevenueWarnings(0, 5498, 13)
    expect(warning).toMatch(/deferred/i)
    expect(warning).toMatch(/expected/i)
    expect(warning).not.toMatch(/UNCOMPUTED/)
  })

  it('flags unverified figures when the schedule check itself failed', () => {
    const [warning] = buildRevenueWarnings(0, 5498, -1)
    expect(warning).toMatch(/unverified/i)
  })
})
