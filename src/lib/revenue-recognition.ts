/**
 * Revenue Recognition Engine — accrual-based revenue tracking.
 *
 * ACCRUAL ACCOUNTING:
 *   When a user pays ₹2,988 for a yearly Pro subscription on Jan 1:
 *   - Cash received: ₹2,988 (immediately)
 *   - Deferred revenue: ₹2,988 (liability — we owe 12 months of service)
 *   - Recognized revenue: ₹0 (we haven't delivered the service yet)
 *
 *   Each month, 1/12 of the deferred revenue is "recognized":
 *   - Jan: Recognized = ₹249, Deferred = ₹2,739
 *   - Feb: Recognized = ₹498, Deferred = ₹2,490
 *   - ...
 *   - Dec: Recognized = ₹2,988, Deferred = ₹0
 *
 * This is REQUIRED for:
 *   - Investor financials (GAAP / Ind AS compliance)
 *   - Tax filing (can't recognize full year's revenue in month 1)
 *   - Accurate MRR reporting (Monthly Recurring Revenue)
 *
 * ALGORITHM:
 *   1. For each active subscription, compute the number of months in the period
 *   2. Divide total amount by number of months → monthly recognition amount
 *   3. Create RevenueSchedule entries for each month
 *   4. Mark past months as "recognized", current month as "current", future as "pending"
 */

import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface RevenueOverview {
  totalDeferred: number          // unearned revenue (future periods)
  totalRecognized: number        // earned revenue (past periods)
  currentMonthRevenue: number    // revenue being recognized this month
  pendingPeriods: number         // future months with scheduled revenue
  recognizedPeriods: number      // past months with recognized revenue
  totalScheduled: number         // total revenue across all schedules
}

export interface MonthlyBreakdown {
  month: string                  // YYYY-MM
  recognized: number             // revenue recognized that month
  deferred: number               // revenue still deferred at end of month
  entries: number                // number of schedule entries
}

// =====================================================================
// COMPUTE REVENUE SCHEDULE FOR A SUBSCRIPTION
// =====================================================================
// Creates monthly RevenueSchedule entries for a subscription.
// Called when a subscription is created (or manually via "Recompute" button).
//
// For a yearly subscription (365+ days): 12 monthly entries
// For a monthly subscription (< 365 days): 1 entry
// For multi-year (730+ days): 24 entries

export async function computeRevenueSchedule(subscriptionId: string): Promise<{
  entriesCreated: number
  monthlyAmount: number
  totalAmount: number
}> {
  // Fetch the subscription
  const subscription = await withTimeout(
    db.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        userId: true,
        plan: true,
        amount: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    }),
    5000
  ).catch(() => null)

  if (!subscription) {
    throw new Error('Subscription not found')
  }

  // Skip cancelled/expired with no remaining period
  if (subscription.status === 'cancelled' && subscription.amount === 0) {
    return { entriesCreated: 0, monthlyAmount: 0, totalAmount: 0 }
  }

  // Delete existing schedules for this subscription (recompute from scratch)
  await db.revenueSchedule.deleteMany({
    where: { subscriptionId: subscription.id },
  })

  // Calculate the number of months in the subscription period
  const start = new Date(subscription.startDate)
  const end = new Date(subscription.endDate)
  const diffMs = end.getTime() - start.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  // Determine number of months (approximate — 30 days per month)
  const numMonths = Math.max(1, Math.round(diffDays / 30))

  // Monthly recognition amount
  const monthlyAmount = Math.round((subscription.amount / numMonths) * 100) / 100

  // Create schedule entries for each month
  const entries: Array<{
    subscriptionId: string
    userId: string
    plan: string
    amount: number
    periodStart: Date
    periodEnd: Date
    status: string
    recognizedAt: Date | null
  }> = []

  const now = new Date()

  for (let i = 0; i < numMonths; i++) {
    const periodStart = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const periodEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 0, 23, 59, 59)

    // Determine status
    let status = 'pending'
    let recognizedAt: Date | null = null

    if (periodEnd < now) {
      // Past month — fully recognized
      status = 'recognized'
      recognizedAt = periodEnd
    } else if (periodStart <= now && periodEnd >= now) {
      // Current month
      status = 'current'
    } else {
      // Future month
      status = 'pending'
    }

    entries.push({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      plan: subscription.plan,
      amount: monthlyAmount,
      periodStart,
      periodEnd,
      status,
      recognizedAt,
    })
  }

  // Batch create
  if (entries.length > 0) {
    await db.revenueSchedule.createMany({ data: entries })
  }

  return {
    entriesCreated: entries.length,
    monthlyAmount,
    totalAmount: subscription.amount,
  }
}

// =====================================================================
// COMPUTE ALL REVENUE SCHEDULES (bulk)
// =====================================================================
// Recomputes schedules for ALL active subscriptions.
// Called by background job or manual "Recompute All" button.
// Uses batch processing (chunks of 100 subscriptions) to avoid memory spikes.

export async function computeAllRevenueSchedules(): Promise<{
  subscriptionsProcessed: number
  entriesCreated: number
  durationMs: number
}> {
  const startTime = Date.now()

  // Fetch all subscriptions (not just active — we need historical too)
  const subscriptions = await withTimeout(
    db.subscription.findMany({
      select: { id: true },
    }),
    10000
  ).catch(() => [])

  let totalEntries = 0

  // Process in chunks of 100
  const CHUNK = 100
  for (let i = 0; i < subscriptions.length; i += CHUNK) {
    const chunk = subscriptions.slice(i, i + CHUNK)
    for (const sub of chunk as any[]) {
      try {
        const result = await computeRevenueSchedule(sub.id)
        totalEntries += result.entriesCreated
      } catch (error) {
        console.error(`[revenue] Failed to compute schedule for ${sub.id}:`, error)
      }
    }
  }

  return {
    subscriptionsProcessed: subscriptions.length,
    entriesCreated: totalEntries,
    durationMs: Date.now() - startTime,
  }
}

// =====================================================================
// GET REVENUE OVERVIEW (from schedules)
// =====================================================================

export async function getRevenueOverview(): Promise<RevenueOverview> {
  const now = new Date()

  // Parallel aggregate queries
  const [deferredAgg, recognizedAgg, currentAgg, pendingCount, recognizedCount, totalAgg] = await Promise.all([
    // Total deferred (future pending periods)
    withTimeout(
      db.revenueSchedule.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // Total recognized (past periods)
    withTimeout(
      db.revenueSchedule.aggregate({
        where: { status: 'recognized' },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // Current month revenue
    withTimeout(
      db.revenueSchedule.aggregate({
        where: { status: 'current' },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // Count of pending periods
    withTimeout(db.revenueSchedule.count({ where: { status: 'pending' } }), 5000).catch(() => 0),

    // Count of recognized periods
    withTimeout(db.revenueSchedule.count({ where: { status: 'recognized' } }), 5000).catch(() => 0),

    // Total scheduled
    withTimeout(
      db.revenueSchedule.aggregate({ _sum: { amount: true } }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),
  ])

  return {
    totalDeferred: deferredAgg._sum.amount || 0,
    totalRecognized: recognizedAgg._sum.amount || 0,
    currentMonthRevenue: currentAgg._sum.amount || 0,
    pendingPeriods: pendingCount,
    recognizedPeriods: recognizedCount,
    totalScheduled: totalAgg._sum.amount || 0,
  }
}

// =====================================================================
// GET MONTHLY BREAKDOWN (for charts)
// =====================================================================
// Returns recognized + deferred revenue per month for the last N months.

export async function getMonthlyBreakdown(months: number = 12): Promise<MonthlyBreakdown[]> {
  const now = new Date()
  const result: MonthlyBreakdown[] = []

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)
    const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`

    // Recognized revenue for this month
    const recognizedAgg = await withTimeout(
      db.revenueSchedule.aggregate({
        where: {
          status: 'recognized',
          periodStart: { gte: monthStart, lte: monthEnd },
        },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } }))

    // Deferred at end of this month (pending + current periods starting after monthEnd)
    const deferredAgg = await withTimeout(
      db.revenueSchedule.aggregate({
        where: {
          status: { in: ['pending', 'current'] },
          periodStart: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } }))

    // Count entries
    const entryCount = await withTimeout(
      db.revenueSchedule.count({
        where: {
          periodStart: { gte: monthStart, lte: monthEnd },
        },
      }),
      5000
    ).catch(() => 0)

    result.push({
      month: monthKey,
      recognized: recognizedAgg._sum.amount || 0,
      deferred: deferredAgg._sum.amount || 0,
      entries: entryCount,
    })
  }

  return result
}
