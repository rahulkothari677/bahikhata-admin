import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * POST /api/admin/compute-daily-stats
 *
 * Computes daily stats for today (or a specified date) and upserts them
 * into the DailyStats table. This is the SCALABILITY FOUNDATION —
 * instead of the dashboard running count() on millions of rows, it
 * reads 1 row from DailyStats.
 *
 * In production, this would be called by a Vercel Cron Job every hour.
 * For now, it can be called manually or on first dashboard load.
 *
 * Body: { date?: "2026-07-02" }  // defaults to today
 */
export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
    const session = isCron ? null : await getServerSession(authOptions)
    if (!isCron && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const targetDate = body.date ? new Date(body.date) : new Date()
    const dayStart = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()))
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const monthStart = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), 1))

    // Run all aggregate queries in parallel — each is a single SQL query
    const [
      totalUsers,
      newUsers,
      activeUsers,
      payingUsers,
      totalTxns,
      salesCount,
      purchasesCount,
      totalGmvAgg,
      monthAiCostAgg,
      todayAiCalls,
      todayAiScans,
      todayVoiceParses,
      activeSubsAgg,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      db.user.count({ where: { updatedAt: { gte: dayStart, lt: dayEnd } } }),
      db.user.count({ where: { plan: { in: ['pro', 'elite'] } } }),
      db.transaction.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      db.transaction.count({ where: { type: 'sale', createdAt: { gte: dayStart, lt: dayEnd } } }),
      db.transaction.count({ where: { type: 'purchase', createdAt: { gte: dayStart, lt: dayEnd } } }),
      db.transaction.aggregate({ where: { type: 'sale' }, _sum: { totalAmount: true } }),
      db.aiUsageLog.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costInr: true } }),
      db.aiUsageLog.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      db.aiUsageLog.count({ where: { feature: 'scan-bill', createdAt: { gte: dayStart, lt: dayEnd } } }),
      db.aiUsageLog.count({ where: { feature: 'voice-parse', createdAt: { gte: dayStart, lt: dayEnd } } }),
      db.subscription.aggregate({ where: { status: 'active' }, _sum: { amount: true } }),
    ])

    const mrr = activeSubsAgg._sum.amount || 0
    const totalGmv = totalGmvAgg._sum.totalAmount || 0
    const aiCostInr = monthAiCostAgg._sum.costInr || 0

    // Upsert into DailyStats (create or update if already exists for this date)
    const stats = await db.dailyStats.upsert({
      where: { date: dayStart },
      create: {
        date: dayStart,
        totalUsers,
        newUsers,
        activeUsers,
        payingUsers,
        mrr,
        arr: mrr * 12,
        totalGmv,
        totalTxns,
        salesCount,
        purchasesCount,
        aiCalls: todayAiCalls,
        aiCostInr,
        aiScans: todayAiScans,
        voiceParses: todayVoiceParses,
        computedAt: new Date(),
      },
      update: {
        totalUsers,
        newUsers,
        activeUsers,
        payingUsers,
        mrr,
        arr: mrr * 12,
        totalGmv,
        totalTxns,
        salesCount,
        purchasesCount,
        aiCalls: todayAiCalls,
        aiCostInr,
        aiScans: todayAiScans,
        voiceParses: todayVoiceParses,
        computedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      message: `Daily stats computed for ${dayStart.toISOString().split('T')[0]}`,
      stats,
    })
  } catch (error) {
    console.error('Compute daily stats error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to compute daily stats',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * GET /api/admin/compute-daily-stats
 * Returns the latest daily stats (for dashboard to read).
 * If no stats exist yet, triggers computation.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get the latest 30 days of stats
    const stats = await db.dailyStats.findMany({
      orderBy: { date: 'desc' },
      take: 30,
    })

    // If no stats exist, return zeros (the POST endpoint will compute them)
    if (stats.length === 0) {
      return NextResponse.json({
        success: true,
        stats: [],
        message: 'No daily stats computed yet. Call POST /api/admin/compute-daily-stats to compute.',
      })
    }

    return NextResponse.json({ success: true, stats })
  } catch (error) {
    console.error('Fetch daily stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily stats' }, { status: 500 })
  }
}
