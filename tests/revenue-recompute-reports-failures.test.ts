/**
 * A revenue recompute where everything failed must not report success.
 *
 * WHY (audit 2026-08-05). computeAllRevenueSchedules() caught each
 * subscription's error, wrote it to the console, and dropped it. It then
 * returned `subscriptionsProcessed: <every subscription found>` and the route
 * returned `success: true` — identical output whether it had recomputed
 * everything or nothing.
 *
 * That was not hypothetical. The DATABASE_URL role cannot DELETE from
 * RevenueSchedule (Postgres 42501 — see src/lib/delete-grants.ts), and the
 * function deletes a subscription's existing schedule before recomputing it. So
 * EVERY subscription was throwing, every run reported success, and recognised
 * revenue — which the P&L reads — silently stopped updating.
 *
 * Fourth time this exact shape has turned up in this audit: the check ran, the
 * answer was known, and nothing carried it to a human. Same as the audit chain
 * nobody verified, the bulk job that reported success after doing nothing, and
 * the nightly reconciliation that stayed green while the books did not tie out.
 *
 * The regression this pins: counting work that did not happen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

const subscriptionFindMany = vi.fn()
const revenueScheduleDeleteMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    subscription: {
      findMany: (...a: unknown[]) => subscriptionFindMany(...a),
      findUnique: vi.fn(async () => ({
        id: 's1', status: 'active', amount: 2999,
        startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
        userId: 'u1', plan: 'pro',
      })),
    },
    revenueSchedule: {
      deleteMany: (...a: unknown[]) => revenueScheduleDeleteMany(...a),
      createMany: vi.fn(async () => ({ count: 12 })),
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
      count: vi.fn(async () => 0),
    },
  },
}))

vi.mock('@/lib/resilience', () => ({
  withTimeout: async (p: Promise<unknown>) => p,
  withNeonRetry: async (fn: () => Promise<unknown>) => fn(),
}))

import { computeAllRevenueSchedules } from '../src/lib/revenue-recognition'

/** What Prisma actually returns when the role lacks DELETE. */
const permissionDenied = () => {
  const e = new Error(
    'Invalid `prisma.revenueSchedule.deleteMany()` invocation:\n\nError occurred during query execution:\n' +
      'PostgresError { code: "42501", message: "permission denied for table RevenueSchedule" }\nDETAIL: row (1,2)',
  )
  return e
}

beforeEach(() => {
  vi.clearAllMocks()
  subscriptionFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
  revenueScheduleDeleteMany.mockResolvedValue({ count: 0 })
})

describe('when every subscription fails', () => {
  it('reports zero processed, not the full count', async () => {
    // The regression: subscriptionsProcessed used to be subscriptions.length,
    // set before any work was attempted.
    revenueScheduleDeleteMany.mockRejectedValue(permissionDenied())
    const r = await computeAllRevenueSchedules()
    expect(r.subscriptionsProcessed).toBe(0)
    expect(r.subscriptionsFound).toBe(3)
  })

  it('counts the failures', async () => {
    revenueScheduleDeleteMany.mockRejectedValue(permissionDenied())
    const r = await computeAllRevenueSchedules()
    expect(r.failed).toBe(3)
  })

  it('carries one real error message, so the cause is visible', async () => {
    revenueScheduleDeleteMany.mockRejectedValue(permissionDenied())
    const r = await computeAllRevenueSchedules()
    expect(r.firstError).toMatch(/42501|permission denied/i)
  })

  it('does not leak row values from the Postgres DETAIL section', async () => {
    revenueScheduleDeleteMany.mockRejectedValue(permissionDenied())
    const r = await computeAllRevenueSchedules()
    expect(r.firstError).not.toMatch(/DETAIL/)
    expect(r.firstError).not.toMatch(/row \(/)
  })
})

describe('when everything succeeds', () => {
  it('reports every subscription processed and no failures', async () => {
    const r = await computeAllRevenueSchedules()
    expect(r.subscriptionsProcessed).toBe(3)
    expect(r.failed).toBe(0)
    expect(r.firstError).toBeNull()
  })
})

describe('a partial failure is still a failure', () => {
  it('separates the ones that worked from the ones that did not', async () => {
    let call = 0
    revenueScheduleDeleteMany.mockImplementation(async () => {
      call++
      if (call === 2) throw permissionDenied()
      return { count: 0 }
    })
    const r = await computeAllRevenueSchedules()
    expect(r.subscriptionsProcessed).toBe(2)
    expect(r.failed).toBe(1)
  })
})

describe('the route turns that into an honest answer', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/admin/revenue-recognition/recompute/route.ts'),
    'utf8',
  )

  it('success reflects whether the work was done', () => {
    // Was a hardcoded `success: true`.
    expect(src).toMatch(/success:\s*result\.failed === 0/)
    expect(src).not.toMatch(/success:\s*true,\s*\n\s*\.\.\.result/)
  })

  it('says out loud that revenue is stale when some failed', () => {
    expect(src).toMatch(/stale/i)
  })

  it('records the failure in the admin audit entry too', () => {
    expect(src).toMatch(/result\.failed > 0[\s\S]{0,120}FAILED/)
  })
})
