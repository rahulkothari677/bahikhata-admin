import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/growth
 *
 * Returns growth analytics:
 *   1. Funnel: signup → first product → first sale → 7-day retention
 *   2. User segments: active, at-risk, churned, power users
 *   3. Referral tracking: viral coefficient, K-factor
 *   4. Growth trends: signups per day (last 30 days)
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    // ===== 1. FUNNEL ANALYTICS =====
    const [
      totalSignups,
      usersWithProducts,
      usersWithSales,
      usersRetained7Days,
    ] = await Promise.all([
      db.user.count(),
      db.product.groupBy({ by: ['userId'], _count: true }).then(g => g.length),
      db.transaction.groupBy({ by: ['userId'], where: { type: 'sale' } }).then(g => g.length),
      // Users who signed up 7+ days ago AND were active in the last 7 days
      db.user.count({
        where: {
          createdAt: { lt: sevenDaysAgo },
          OR: [
            { transactions: { some: { createdAt: { gte: sevenDaysAgo } } } },
            { aiUsageLogs: { some: { createdAt: { gte: sevenDaysAgo } } } },
          ],
        },
      }),
    ])

    // Users who signed up 7+ days ago (denominator for retention)
    const usersOldEnoughForRetention = await db.user.count({
      where: { createdAt: { lt: sevenDaysAgo } },
    })

    const funnel = {
      signup: totalSignups,
      firstProduct: usersWithProducts,
      firstSale: usersWithSales,
      retained7Days: usersRetained7Days,
      conversionRates: {
        signupToProduct: totalSignups > 0 ? Math.round((usersWithProducts / totalSignups) * 100) : 0,
        productToSale: usersWithProducts > 0 ? Math.round((usersWithSales / usersWithProducts) * 100) : 0,
        saleToRetention: usersWithSales > 0 ? Math.round((usersRetained7Days / usersWithSales) * 100) : 0,
        overallRetention: usersOldEnoughForRetention > 0 ? Math.round((usersRetained7Days / usersOldEnoughForRetention) * 100) : 0,
      },
    }

    // ===== 2. USER SEGMENTS =====
    const [
      activeUsers,      // Active in last 7 days
      atRiskUsers,      // Active 7-30 days ago, not since
      churnedUsers,     // No activity in 30+ days
      powerUsers,       // 50+ transactions
      newUsers,         // Signed up in last 7 days
    ] = await Promise.all([
      db.user.count({
        where: {
          OR: [
            { transactions: { some: { createdAt: { gte: sevenDaysAgo } } } },
            { aiUsageLogs: { some: { createdAt: { gte: sevenDaysAgo } } } },
          ],
        },
      }),
      db.user.count({
        where: {
          createdAt: { lt: sevenDaysAgo },
          updatedAt: { gte: thirtyDaysAgo, lt: sevenDaysAgo },
          NOT: {
            OR: [
              { transactions: { some: { createdAt: { gte: sevenDaysAgo } } } },
              { aiUsageLogs: { some: { createdAt: { gte: sevenDaysAgo } } } },
            ],
          },
        },
      }),
      db.user.count({
        where: {
          createdAt: { lt: thirtyDaysAgo },
          updatedAt: { lt: thirtyDaysAgo },
          NOT: {
            OR: [
              { transactions: { some: { createdAt: { gte: thirtyDaysAgo } } } },
              { aiUsageLogs: { some: { createdAt: { gte: thirtyDaysAgo } } } },
            ],
          },
        },
      }),
      db.transaction.groupBy({
        by: ['userId'],
        _count: { id: true },
        having: { id: { _count: { gte: 50 } } },
      }).then(g => g.length),
      db.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ])

    const segments = {
      active: activeUsers,
      atRisk: atRiskUsers,
      churned: churnedUsers,
      power: powerUsers,
      new: newUsers,
    }

    // ===== 3. REFERRAL TRACKING =====
    const [
      totalReferrals,
      completedReferrals,
      rewardedReferrals,
      referralUsers,
    ] = await Promise.all([
      db.referral.count(),
      db.referral.count({ where: { status: 'completed' } }),
      db.referral.count({ where: { rewardGiven: true } }),
      db.referral.groupBy({
        by: ['referrerId'],
        where: { status: 'completed' },
        _count: true,
      }),
    ])

    // K-factor = average referrals per user × conversion rate
    const avgReferralsPerUser = totalSignups > 0 ? completedReferrals / totalSignups : 0
    const referralConversionRate = totalReferrals > 0 ? completedReferrals / totalReferrals : 0
    const kFactor = avgReferralsPerUser * referralConversionRate

    // Top referrers
    const topReferrerIds = referralUsers.sort((a, b) => b._count - a._count).slice(0, 5).map(r => r.referrerId)
    const topReferrerDetails = await db.user.findMany({
      where: { id: { in: topReferrerIds } },
      select: { id: true, email: true, name: true },
    })
    const topReferrers = referralUsers
      .sort((a, b) => b._count - a._count)
      .slice(0, 5)
      .map(r => ({
        ...r,
        user: topReferrerDetails.find(d => d.id === r.referrerId),
      }))

    const referrals = {
      total: totalReferrals,
      completed: completedReferrals,
      rewarded: rewardedReferrals,
      conversionRate: Math.round(referralConversionRate * 100),
      kFactor: Math.round(kFactor * 100) / 100,
      isViral: kFactor >= 1,
      topReferrers,
    }

    // ===== 4. GROWTH TRENDS (signups per day, last 30 days) =====
    const recentSignups = await db.user.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group by day
    const signupsByDay: Record<string, number> = {}
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const dateKey = date.toISOString().split('T')[0]
      signupsByDay[dateKey] = 0
    }
    for (const signup of recentSignups) {
      const dateKey = signup.createdAt.toISOString().split('T')[0]
      if (signupsByDay[dateKey] !== undefined) {
        signupsByDay[dateKey]++
      }
    }

    const growthTrend = Object.entries(signupsByDay).map(([date, count]) => ({
      date,
      signups: count,
    }))

    // Calculate growth rate (last 7 days vs previous 7 days)
    const last7Days = growthTrend.slice(-7).reduce((s, d) => s + d.signups, 0)
    const previous7Days = growthTrend.slice(-14, -7).reduce((s, d) => s + d.signups, 0)
    const signupGrowthRate = previous7Days > 0
      ? Math.round(((last7Days - previous7Days) / previous7Days) * 100)
      : last7Days > 0 ? 100 : 0

    return NextResponse.json({
      success: true,
      funnel,
      segments,
      referrals,
      growthTrend: {
        data: growthTrend,
        last7Days,
        previous7Days,
        growthRate: signupGrowthRate,
      },
    })
  } catch (error) {
    console.error('Growth analytics error:', error)
    return NextResponse.json({ error: 'Failed to fetch growth analytics' }, { status: 500 })
  }
}
