import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'

/**
 * GET /api/admin/revenue
 *
 * Returns comprehensive revenue analytics:
 *   - Cohort retention (weekly cohorts: signup week → still active week 4, 8, 12)
 *   - Churn tracking (users who cancelled or went inactive)
 *   - LTV calculation per cohort
 *   - Revenue forecasting (projected MRR based on growth rate)
 *   - Payment success/failure rates
 *   - MRR/ARR with breakdown
 */

export const GET = withAdmin(
  'admin/revenue',
  async (req: NextRequest, ctx) => {
  try {
    const now = new Date()

    // ===== 1. COHORT RETENTION (last 8 weeks) =====
    // Group users by the week they signed up, then track how many are still active
    // in subsequent weeks. "Active" = has a transaction or AI call in that week.
    const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 24 * 60 * 60 * 1000)

    const usersInLast8Weeks = await db.user.findMany({
      where: { createdAt: { gte: eightWeeksAgo } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group users by signup week (week 0 = this week, week -1 = last week, etc.)
    const cohorts: Record<string, string[]> = {} // weekKey -> userIds
    for (const user of usersInLast8Weeks) {
      const weekStart = getWeekStart(user.createdAt)
      const weekKey = weekStart.toISOString().split('T')[0]
      if (!cohorts[weekKey]) cohorts[weekKey] = []
      cohorts[weekKey].push(user.id)
    }

    // For each cohort, calculate retention for weeks 0, 1, 2, 3, 4
    const cohortRetention = await Promise.all(
      Object.entries(cohorts).map(async ([weekKey, userIds]) => {
        const cohortDate = new Date(weekKey)
        const cohortSize = userIds.length

        // Calculate retention for weeks 0-4 after signup
        const retention: number[] = []
        for (let weekOffset = 0; weekOffset <= 4; weekOffset++) {
          const weekStart = new Date(cohortDate.getTime() + weekOffset * 7 * 24 * 60 * 60 * 1000)
          const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)

          // Can't measure future weeks
          if (weekStart > now) {
            retention.push(-1) // -1 = not yet measurable
            continue
          }

          // Count how many users from this cohort were active in this week
          const activeUsers = await db.user.count({
            where: {
              id: { in: userIds },
              OR: [
                { transactions: { some: { createdAt: { gte: weekStart, lt: weekEnd } } } },
                { aiUsageLogs: { some: { createdAt: { gte: weekStart, lt: weekEnd } } } },
              ],
            },
          })

          retention.push(cohortSize > 0 ? Math.round((activeUsers / cohortSize) * 100) : 0)
        }

        return {
          cohortWeek: weekKey,
          cohortSize,
          retention, // [week0%, week1%, week2%, week3%, week4%]
        }
      })
    )

    // ===== 2. CHURN TRACKING =====
    // Users who cancelled their subscription
    const churnedUsers = await db.user.count({
      where: { cancelledAt: { not: null } },
    })

    // Users who were active 30 days ago but not in last 7 days (inactive churn)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const active30DaysAgo = await db.user.count({
      where: {
        updatedAt: { gte: thirtyDaysAgo, lt: sevenDaysAgo },
      },
    })

    // Active users who haven't been seen in 7+ days (at-risk)
    const atRiskUsers = await db.user.count({
      where: {
        updatedAt: { lt: sevenDaysAgo },
        createdAt: { lt: sevenDaysAgo }, // exclude new signups
      },
    })

    // ===== 3. LTV CALCULATION =====
    // Average revenue per paying user × average subscription duration
    // 🐛 SCALE FIX (audit 2026-07-28): this loaded EVERY active subscription
    // into the function and summed them in JavaScript. At 100K paying users
    // that is 100K rows crossing the wire to produce two numbers; at a million
    // it is an out-of-memory kill on a dashboard.
    //
    // The sum now happens in Postgres, which returns one row regardless of how
    // many subscribers exist. This is the same shape as the aggregate() calls
    // used elsewhere in this route — the only reason it could not use
    // aggregate() is the yearly/monthly split, which is derived from the dates
    // rather than stored, so it needs a CASE expression.
    //
    // 💰 $queryRaw BYPASSES the Prisma money extension: "amount" comes back in
    // PAISE, not rupees. The division by 100 below is therefore REQUIRED and
    // must not be "cleaned up" — the extension converts findMany/aggregate
    // results, and this is neither. Same convention as anomaly-detection.ts.
    const [ltvRow] = await db.$queryRaw<Array<{ paying_users: bigint; monthly_paise: bigint | null }>>`
      SELECT
        COUNT(*)::bigint AS paying_users,
        COALESCE(SUM(
          CASE
            WHEN "endDate" - "startDate" > INTERVAL '60 days' THEN "amount" / 12.0
            ELSE "amount"
          END
        ), 0)::bigint AS monthly_paise
      FROM "Subscription"
      WHERE "status" = 'active'
    `

    const payingUsers = Number(ltvRow?.paying_users ?? 0)
    const totalActiveRevenue = Number(ltvRow?.monthly_paise ?? 0) / 100

    const arpu = payingUsers > 0 ? totalActiveRevenue / payingUsers : 0
    // Assume average customer lifetime of 12 months (conservative estimate)
    const avgLifetimeMonths = 12
    const ltv = arpu * avgLifetimeMonths

    // ===== 4. REVENUE FORECASTING =====
    // Calculate growth rate from last 2 months of subscriptions
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [lastMonthSubs, thisMonthSubs] = await Promise.all([
      db.subscription.aggregate({
        where: { createdAt: { gte: lastMonthStart, lt: thisMonthStart } },
        _sum: { amount: true },
        _count: true,
      }),
      db.subscription.aggregate({
        where: { createdAt: { gte: thisMonthStart } },
        _sum: { amount: true },
        _count: true,
      }),
    ])

    const lastMonthRevenue = lastMonthSubs._sum.amount || 0
    const thisMonthRevenue = thisMonthSubs._sum.amount || 0
    const growthRate = lastMonthRevenue > 0
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : 0

    // Project next 3 months based on growth rate
    const forecast: { month: string; projectedMrr: number }[] = []
    let projectedMrr = totalActiveRevenue
    for (let i = 1; i <= 3; i++) {
      projectedMrr = projectedMrr * (1 + growthRate / 100)
      const forecastDate = new Date(now.getFullYear(), now.getMonth() + i, 1)
      forecast.push({
        month: forecastDate.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
        projectedMrr: Math.round(projectedMrr),
      })
    }

    // ===== 5. PAYMENT SUCCESS/FAILURE RATES =====
    // 📊 SCALE (audit 2026-07-27). This loaded EVERY subscription row ever
    // created into memory — with no take, no where — purely to count them by
    // status in JavaScript. On a Vercel function with 1GB and no swap, that is
    // an out-of-memory crash the moment the table gets large, and it grows
    // with the business rather than with the query.
    //
    // groupBy does the same work in the database and returns one row per
    // status, regardless of whether there are a hundred subscriptions or ten
    // million.
    const statusCounts = await db.subscription.groupBy({
      by: ['status'],
      _count: { _all: true },
    }).catch(ctx.degrade('subscription.groupBy', [] as Array<{ status: string; _count: { _all: number } }>))

    const countFor = (s: string) =>
      statusCounts.find((r: any) => r.status === s)?._count?._all ?? 0

    const successfulPayments = countFor('active')
    const cancelledPayments = countFor('cancelled')
    const expiredPayments = countFor('expired')
    const totalSubscriptionCount = (statusCounts as any[]).reduce<number>(
      (sum, r) => sum + (r._count?._all ?? 0), 0,
    )
    const paymentSuccessRate = totalSubscriptionCount > 0
      ? (successfulPayments / totalSubscriptionCount) * 100
      : 0

    // ===== 6. MRR/ARR BREAKDOWN =====
    // 🐛 FIX (audit 2026-07-27). `pro` and `elite` were computed with the
    // IDENTICAL filter expression — both summed monthly-duration subscriptions
    // regardless of plan — so the two lines of the breakdown always showed the
    // SAME number. The trailing comment ("real breakdown would check the plan
    // field") described the bug without fixing it, and the plan field it names
    // was sitting right there on the model.
    //
    // A revenue breakdown where every row is the same figure is worse than no
    // breakdown: it looks like data.
    const planBreakdown = await db.subscription.groupBy({
      by: ['plan'],
      where: { status: 'active' },
      _sum: { amount: true },
    }).catch(ctx.degrade('subscription.groupBy.plan', [] as Array<{ plan: string; _sum: { amount: number | null } }>))

    const sumForPlan = (p: string) =>
      planBreakdown.find((r: any) => r.plan === p)?._sum?.amount ?? 0

    const mrrBreakdown = {
      pro: sumForPlan('pro'),
      elite: sumForPlan('elite'),
    }

    const arr = totalActiveRevenue * 12

    // ===== 7. MRR MOVEMENT ANALYSIS =====
    // Breaks down MRR changes into: New, Expansion, Contraction, Churn
    const thisMonthSubsDetailed = await db.subscription.findMany({
      where: { createdAt: { gte: thisMonthStart } },
      select: { amount: true, plan: true, status: true, startDate: true, endDate: true },
    })

    const newMrr = thisMonthSubsDetailed
      .filter(s => s.status === 'active')
      .reduce((sum, s) => {
        const isYearly = s.endDate?.getTime() - s.startDate?.getTime() > 60 * 24 * 60 * 60 * 1000
        return sum + (isYearly ? s.amount / 12 : s.amount)
      }, 0)

    // Churned MRR: subscriptions that were cancelled this month
    const churnedSubsThisMonth = await db.subscription.findMany({
      where: {
        status: 'cancelled',
        // Check if user's cancelledAt is this month
      },
      select: { amount: true, plan: true, startDate: true, endDate: true },
    })

    const churnedMrr = churnedSubsThisMonth.reduce((sum, s) => {
      const isYearly = s.endDate.getTime() - s.startDate.getTime() > 60 * 24 * 60 * 60 * 1000
      return sum + (isYearly ? s.amount / 12 : s.amount)
    }, 0)

    // Expansion MRR: users who upgraded (pro → elite) this month
    // Simplified: count elite subscriptions started this month as expansion
    const expansionMrr = thisMonthSubsDetailed
      .filter(s => s.plan === 'elite' && s.status === 'active')
      .reduce((sum, s) => sum + s.amount, 0)

    // Net MRR movement
    const netMrrMovement = newMrr + expansionMrr - churnedMrr

    return NextResponse.json({
      success: true,
      cohortRetention: cohortRetention.reverse(), // most recent first
      churn: {
        cancelledUsers: churnedUsers,
        atRiskUsers,
        active30DaysAgo,
      },
      ltv: {
        arpu: Math.round(arpu),
        avgLifetimeMonths,
        ltv: Math.round(ltv),
        payingUsers,
      },
      forecast: {
        currentMrr: Math.round(totalActiveRevenue),
        lastMonthRevenue,
        thisMonthRevenue,
        growthRate: Math.round(growthRate * 10) / 10,
        projections: forecast,
        arr: Math.round(arr),
        // 🐛 (audit 2026-07-27) mrrBreakdown was computed and then never
        // returned — dead code the response never carried. Fixing its
        // duplicate-plan bug alone would have changed nothing anyone could
        // see, which is its own trap: the calculation looks correct in review
        // while the screen shows nothing. Now actually returned.
        mrrBreakdown,
      },
      payments: {
        total: totalSubscriptionCount,
        successful: successfulPayments,
        cancelled: cancelledPayments,
        expired: expiredPayments,
        successRate: Math.round(paymentSuccessRate * 10) / 10,
      },
      mrrMovement: {
        newMrr: Math.round(newMrr),
        expansionMrr: Math.round(expansionMrr),
        churnedMrr: Math.round(churnedMrr),
        netMovement: Math.round(netMrrMovement),
      },
    })
  } catch (error) {
    console.error('Revenue analytics error:', error)
    return NextResponse.json({ error: 'Failed to fetch revenue analytics' }, { status: 500 })
  }
},
)

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day // Sunday = 0
  return new Date(d.setDate(diff))
}
