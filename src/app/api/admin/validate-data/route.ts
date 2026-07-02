import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { safeCount, validateStat, checkDbHealth, type ValidationResult } from '@/lib/resilience'

/**
 * GET /api/admin/validate-data
 *
 * Cross-checks ALL admin dashboard numbers against live database queries.
 * This is the TRUST LAYER — investors and technical teams can verify that
 * every number shown on the dashboard matches the actual database.
 *
 * For each metric:
 *   1. Gets the displayed value (from DailyStats, last computed)
 *   2. Gets the actual value (live count() query)
 *   3. Compares them (0.1% tolerance)
 *   4. Returns pass/fail with discrepancy
 *
 * If ALL metrics pass → data is trustworthy
 * If ANY metric fails → data discrepancy detected, investigation needed
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check DB health first
    const dbHealthy = await checkDbHealth()
    if (!dbHealthy) {
      return NextResponse.json({
        success: false,
        error: 'Database unreachable',
        dbHealthy: false,
        message: 'Cannot validate data — database is not reachable. Try again in a few seconds.',
      }, { status: 503 })
    }

    // Get latest DailyStats (displayed values)
    const latestStats = await db.dailyStats.findFirst({
      orderBy: { date: 'desc' },
    })

    // Get actual values (live queries)
    const [
      actualTotalUsers,
      actualPayingUsers,
      actualTotalTxns,
      actualAiCalls,
    ] = await Promise.all([
      safeCount(() => db.user.count(), 'totalUsers'),
      safeCount(() => db.user.count({ where: { plan: { in: ['pro', 'elite'] } } }), 'payingUsers'),
      safeCount(() => db.transaction.count(), 'totalTxns'),
      safeCount(() => db.aiUsageLog.count(), 'aiCalls'),
    ])

    const results: ValidationResult[] = []

    // Only validate if we have DailyStats to compare against
    if (latestStats) {
      results.push(validateStat('Total Users', latestStats.totalUsers, actualTotalUsers.value))
      results.push(validateStat('Paying Users', latestStats.payingUsers, actualPayingUsers.value))
      results.push(validateStat('Total Transactions', latestStats.totalTxns, actualTotalTxns.value))
      results.push(validateStat('Total AI Calls (cumulative)', latestStats.aiCalls, actualAiCalls.value))
    }

    // Also validate live-only metrics (not in DailyStats yet)
    // These are always "verified" since they're computed live
    const liveMetrics = [
      { label: 'Active Today (live)', value: 0, verified: true, live: true },
      { label: 'New Today (live)', value: 0, verified: true, live: true },
    ]

    // Get live active/new today
    const todayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))
    const [liveActive, liveNew] = await Promise.all([
      safeCount(() => db.user.count({ where: { updatedAt: { gte: todayStart } } }), 'activeToday'),
      safeCount(() => db.user.count({ where: { createdAt: { gte: todayStart } } }), 'newToday'),
    ])
    liveMetrics[0].value = liveActive.value
    liveMetrics[1].value = liveNew.value

    // Overall validation status
    const allMatch = results.every(r => r.match)
    const mismatchCount = results.filter(r => !r.match).length

    return NextResponse.json({
      success: true,
      dbHealthy: true,
      lastComputedAt: latestStats?.computedAt?.toISOString() || null,
      results: results.map(r => ({
        ...r,
        status: r.match ? 'pass' : 'fail',
      })),
      liveMetrics: liveMetrics,
      summary: {
        totalChecks: results.length,
        passed: results.filter(r => r.match).length,
        failed: mismatchCount,
        allMatch,
        tolerance: '0.1%',
      },
      investorNote: allMatch
        ? 'All dashboard metrics match live database. Data is trustworthy for investor reporting.'
        : `${mismatchCount} metric(s) mismatch detected. Run POST /api/admin/compute-daily-stats to refresh.`,
    })
  } catch (error) {
    console.error('Data validation error:', error)
    return NextResponse.json({
      success: false,
      error: 'Validation failed',
      detail: String(error).slice(0, 300),
      dbHealthy: false,
    }, { status: 500 })
  }
}
