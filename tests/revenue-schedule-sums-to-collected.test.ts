import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A revenue schedule must sum to the amount actually collected.
 *
 * WHY (audit 2026-08-04, Phase 7). Every schedule entry carried the same
 * rounded monthly figure and nothing absorbed the remainder:
 *
 *   Pro yearly   2999 / 12 = 249.9166… -> 249.92  ×12 = 2999.04  (+0.04)
 *   Elite yearly 5999 / 12 = 499.9166… -> 499.92  ×12 = 5999.04  (+0.04)
 *
 * Four paise recognised that were never collected, on every yearly
 * subscription, always OVER and never under because the third decimal rounds up.
 *
 * The amount is trivial. The property is not: recognised revenue exceeding cash
 * received breaks the reconciliation an auditor or a diligence team runs first
 * — deferred + recognised should equal collected, exactly. A number that does
 * not tie out invites a question about every other number.
 *
 * The fix gives the FINAL period the remainder. These tests assert the invariant
 * across plans and term lengths rather than the specific arithmetic, so they
 * still hold if pricing changes.
 */

const created: Array<{ data: Array<{ amount: number; periodStart: Date }> }> = []

vi.mock('@/lib/db', () => ({
  db: {
    subscription: { findUnique: vi.fn() },
    revenueSchedule: {
      createMany: vi.fn(async (args: { data: Array<{ amount: number; periodStart: Date }> }) => {
        created.push(args)
        return { count: args.data.length }
      }),
      deleteMany: vi.fn(),
    },
  },
}))

import { db } from '@/lib/db'
import { computeRevenueSchedule } from '@/lib/revenue-recognition'

/** Sum the entries written for one subscription, in paise, to avoid float noise. */
function scheduledTotal(): number {
  const paise = created
    .flatMap(c => c.data)
    .reduce((sum, e) => sum + Math.round(e.amount * 100), 0)
  return Math.round(paise) / 100
}

function stubSubscription(amount: number, days: number) {
  const startDate = new Date('2026-01-01T00:00:00Z')
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000)
  ;(db.subscription.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'sub_1', userId: 'user_1', plan: 'pro', amount, status: 'active', startDate, endDate,
  })
}

beforeEach(() => {
  created.length = 0
  vi.clearAllMocks()
})

describe('the schedule sums to exactly what was collected', () => {
  it.each([
    ['Pro yearly', 2999, 365],
    ['Elite yearly', 5999, 365],
    ['Pro monthly', 299, 30],
    ['Elite monthly', 599, 30],
    // Amounts chosen to divide badly: 1/12 recurs, 1/12 terminates, prime.
    ['awkward 1000', 1000, 365],
    ['awkward 100', 100, 365],
    ['awkward 4999', 4999, 365],
    ['prime 1013', 1013, 365],
  ])('%s (%i) ties out to the paisa', async (_label, amount, days) => {
    stubSubscription(amount, days)
    await computeRevenueSchedule('sub_1')
    expect(scheduledTotal()).toBe(amount)
  })

  it('never recognises MORE than was collected — the direction that matters', async () => {
    // Over-recognition is the failure an auditor flags. Under is merely wrong.
    for (const amount of [2999, 5999, 299, 1013, 4999, 777, 12345]) {
      created.length = 0
      stubSubscription(amount, 365)
      await computeRevenueSchedule('sub_1')
      expect(scheduledTotal()).toBeLessThanOrEqual(amount)
    }
  })
})

describe('the instalments are still even', () => {
  it('puts the remainder in the LAST period only', async () => {
    stubSubscription(2999, 365)
    await computeRevenueSchedule('sub_1')
    const amounts = created.flatMap(c => c.data).map(e => e.amount)
    expect(amounts.length).toBeGreaterThan(1)

    const allButLast = amounts.slice(0, -1)
    // Every month except the last is identical — a schedule with drift spread
    // across it would be arbitrary and hard to explain to a finance reviewer.
    expect(new Set(allButLast).size).toBe(1)

    // And the last differs by less than one rupee; it is a remainder, not a
    // different price.
    expect(Math.abs(amounts[amounts.length - 1] - allButLast[0])).toBeLessThan(1)
  })

  it('handles a single-period subscription without a phantom remainder', async () => {
    stubSubscription(299, 30)
    await computeRevenueSchedule('sub_1')
    const amounts = created.flatMap(c => c.data).map(e => e.amount)
    expect(amounts).toEqual([299])
  })

  it('schedules nothing but stays at zero for a free grant', async () => {
    // Referral rewards and admin grants are real subscriptions with amount 0.
    stubSubscription(0, 365)
    await computeRevenueSchedule('sub_1')
    expect(scheduledTotal()).toBe(0)
  })
})
