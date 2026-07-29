import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { dbRead } from '@/lib/db'

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

    // 🐛 SCALE FIX (audit 2026-07-29). This was the worst query in the panel.
    //
    // It loaded EVERY user who signed up in the last 8 weeks, grouped them into
    // cohorts in JavaScript, and then ran a `user.count` per cohort per week —
    // up to 40 follow-up queries, each carrying the cohort's entire id list in
    // an `IN (...)`. During a strong quarter that is the whole new user base
    // fetched, then posted back to Postgres forty times.
    //
    // One statement now. It returns at most 8 cohorts x 5 offsets = 40 small
    // rows however large the business gets, and no id list ever leaves the
    // database.
    //
    // WEEK BOUNDARY: Postgres date_trunc('week') starts on MONDAY; the previous
    // getWeekStart() started on SUNDAY. Shifting by a day before truncating and
    // back after preserves the original Sunday-start cohorts exactly — changing
    // it silently would move every historical cohort by one day and make this
    // quarter's retention incomparable with last quarter's.
    const cohortRows = await dbRead.$queryRaw<Array<{
      cohort_week: Date
      cohort_size: bigint
      week_offset: number | null
      active_users: bigint
    }>>`
      WITH cohort AS (
        SELECT
          "id" AS user_id,
          date_trunc('week', "createdAt" + INTERVAL '1 day') - INTERVAL '1 day' AS cohort_week
        FROM "User"
        WHERE "createdAt" >= ${eightWeeksAgo}
      ),
      sizes AS (
        SELECT cohort_week, COUNT(*)::bigint AS cohort_size
        FROM cohort GROUP BY cohort_week
      ),
      acts AS (
        SELECT "userId" AS user_id, "createdAt" AS ts
        FROM "Transaction" WHERE "createdAt" >= ${eightWeeksAgo}
        UNION ALL
        SELECT "userId", "createdAt"
        FROM "AiUsageLog" WHERE "createdAt" >= ${eightWeeksAgo}
      ),
      active AS (
        SELECT DISTINCT
          c.cohort_week,
          c.user_id,
          (EXTRACT(EPOCH FROM (
            (date_trunc('week', a.ts + INTERVAL '1 day') - INTERVAL '1 day') - c.cohort_week
          )) / 604800)::int AS week_offset
        FROM cohort c
        JOIN acts a ON a.user_id = c.user_id
      )
      SELECT
        s.cohort_week,
        s.cohort_size,
        act.week_offset,
        COUNT(act.user_id)::bigint AS active_users
      FROM sizes s
      LEFT JOIN active act
        ON act.cohort_week = s.cohort_week
       AND act.week_offset BETWEEN 0 AND 4
      GROUP BY s.cohort_week, s.cohort_size, act.week_offset
      ORDER BY s.cohort_week
    `

    // Reshape into one row per cohort with a 5-slot retention array.
    const byCohort = new Map<string, { cohortSize: number; active: Map<number, number> }>()
    for (const row of cohortRows) {
      const key = new Date(row.cohort_week).toISOString().split('T')[0]
      let entry = byCohort.get(key)
      if (!entry) {
        entry = { cohortSize: Number(row.cohort_size), active: new Map() }
        byCohort.set(key, entry)
      }
      if (row.week_offset !== null) {
        entry.active.set(row.week_offset, Number(row.active_users))
      }
    }

    const cohortRetention = [...byCohort.entries()].map(([weekKey, entry]) => {
      const cohortDate = new Date(weekKey)
      const retention: number[] = []
      for (let weekOffset = 0; weekOffset <= 4; weekOffset++) {
        const weekStart = new Date(cohortDate.getTime() + weekOffset * 7 * 24 * 60 * 60 * 1000)
        // -1 means "not yet measurable", not "nobody came back". Collapsing the
        // two would render a brand-new cohort as 0% retained.
        if (weekStart > now) { retention.push(-1); continue }
        const activeUsers = entry.active.get(weekOffset) ?? 0
        retention.push(entry.cohortSize > 0 ? Math.round((activeUsers / entry.cohortSize) * 100) : 0)
      }
      return { cohortWeek: weekKey, cohortSize: entry.cohortSize, retention }
    })

    // ===== 2. CHURN TRACKING =====
    // Users who cancelled their subscription
    const churnedUsers = await dbRead.user.count({
      where: { cancelledAt: { not: null } },
    })

    // Users who were active 30 days ago but not in last 7 days (inactive churn)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const active30DaysAgo = await dbRead.user.count({
      where: {
        updatedAt: { gte: thirtyDaysAgo, lt: sevenDaysAgo },
      },
    })

    // Active users who haven't been seen in 7+ days (at-risk)
    const atRiskUsers = await dbRead.user.count({
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
    const [ltvRow] = await dbRead.$queryRaw<Array<{ paying_users: bigint; monthly_paise: bigint | null }>>`
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
      dbRead.subscription.aggregate({
        where: { createdAt: { gte: lastMonthStart, lt: thisMonthStart } },
        _sum: { amount: true },
        _count: true,
      }),
      dbRead.subscription.aggregate({
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
    const statusCounts = await dbRead.subscription.groupBy({
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
    const planBreakdown = await dbRead.subscription.groupBy({
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
    // 🐛 TWO FIXES (audit 2026-07-29), one of them a wrong number on the
    // dashboard rather than a slow query.
    //
    // 1. CORRECTNESS. `churnedSubsThisMonth` was
    //        where: { status: 'cancelled' }   // Check if user's cancelledAt is this month
    //    — a comment describing a filter that was never written. It summed
    //    EVERY cancellation in the product's history and reported it as "churn
    //    this month". Because churnedMrr feeds netMrrMovement, that figure was
    //    not merely wrong but drifted further negative every month, for good
    //    and bad months alike. Subscription has no cancelledAt of its own; the
    //    cancellation date lives on User, which is what the comment meant.
    //
    // 2. SCALE. Both queries loaded every matching row to sum them in JS.
    //
    // 💰 $queryRaw BYPASSES the money extension — these come back in PAISE and
    // the /100 below is required. Same convention as the LTV query above.
    const [mrrRow] = await dbRead.$queryRaw<Array<{
      new_paise: bigint | null
      expansion_paise: bigint | null
    }>>`
      SELECT
        COALESCE(SUM(
          CASE WHEN "endDate" - "startDate" > INTERVAL '60 days'
               THEN "amount" / 12.0 ELSE "amount" END
        ), 0)::bigint AS new_paise,
        COALESCE(SUM(
          CASE WHEN "plan" = 'elite' THEN "amount" ELSE 0 END
        ), 0)::bigint AS expansion_paise
      FROM "Subscription"
      WHERE "status" = 'active' AND "createdAt" >= ${thisMonthStart}
    `

    const newMrr = Number(mrrRow?.new_paise ?? 0) / 100
    const expansionMrr = Number(mrrRow?.expansion_paise ?? 0) / 100

    // Churned MRR: subscriptions whose OWNER cancelled during this month.
    const [churnRow] = await dbRead.$queryRaw<Array<{ churned_paise: bigint | null }>>`
      SELECT COALESCE(SUM(
        CASE WHEN s."endDate" - s."startDate" > INTERVAL '60 days'
             THEN s."amount" / 12.0 ELSE s."amount" END
      ), 0)::bigint AS churned_paise
      FROM "Subscription" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE s."status" = 'cancelled'
        AND u."cancelledAt" >= ${thisMonthStart}
    `

    const churnedMrr = Number(churnRow?.churned_paise ?? 0) / 100

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

// getWeekStart() was removed on 2026-07-29 when cohort bucketing moved into
// SQL. Keeping it would leave two definitions of "which week is this?" in the
// codebase, and the next person to need one would reach for the JavaScript
// version and silently produce Sunday-start weeks where the query produces
// Monday-shifted ones. The equivalent lives in the cohort CTE above, as
//   date_trunc('week', ts + INTERVAL '1 day') - INTERVAL '1 day'
