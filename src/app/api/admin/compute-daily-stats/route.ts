import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
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
export const POST = withAdmin(
  'admin/compute-daily-stats',
  async (req: NextRequest, ctx) => {
  try {
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
      // 🔒 2026-08-04 (Phase 7 audit): deleted transactions were counted. This
      // job WRITES A ROLLUP ROW, so a wrong number here is not just a wrong
      // screen — it is baked into stored history and every later chart reads
      // it back as fact. Same omission as admin/overview; see the note there.
      db.transaction.count({ where: { createdAt: { gte: dayStart, lt: dayEnd }, deletedAt: null } }),
      db.transaction.count({ where: { type: 'sale', createdAt: { gte: dayStart, lt: dayEnd }, deletedAt: null } }),
      db.transaction.count({ where: { type: 'purchase', createdAt: { gte: dayStart, lt: dayEnd }, deletedAt: null } }),
      db.transaction.aggregate({ where: { type: 'sale', deletedAt: null }, _sum: { totalAmount: true } }),
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

    // ═══════════════════════════════════════════════════════════════════════
    // 📊 Refresh the denormalised per-user activity counters.
    //
    // These back the admin users list, which previously used `_count` on four
    // relations — a correlated subquery per row, 100 of them for a 25-row page
    // over the transaction table.
    //
    // Done as ONE set-based UPDATE ... FROM rather than per-user queries: at a
    // million users, a loop of updates is a million round trips. The database
    // does the join once.
    //
    // INCREMENTAL by default: only users whose counters are stale or who have
    // been active since the last run. A full recompute over a billion
    // transactions every night is exactly the kind of job that quietly starts
    // taking six hours and then starts overlapping itself.
    // ═══════════════════════════════════════════════════════════════════════
    const rollupStart = Date.now()
    const staleBefore = new Date(Date.now() - 23 * 60 * 60 * 1000)

    const rollupRows = await db.$executeRawUnsafe(`
      UPDATE "User" u
      SET "txnCount"        = COALESCE(c.txn_count, 0),
          "productCount"    = COALESCE(c.product_count, 0),
          "partyCount"      = COALESCE(c.party_count, 0),
          "countsUpdatedAt" = NOW()
      FROM (
        SELECT u2.id,
               (SELECT COUNT(*) FROM "Transaction" t WHERE t."userId" = u2.id) AS txn_count,
               (SELECT COUNT(*) FROM "Product"     p WHERE p."userId" = u2.id) AS product_count,
               (SELECT COUNT(*) FROM "Party"       y WHERE y."userId" = u2.id) AS party_count
        FROM "User" u2
        WHERE u2."countsUpdatedAt" IS NULL
           OR u2."countsUpdatedAt" < $1
           OR u2."updatedAt"       > u2."countsUpdatedAt"
        LIMIT 50000
      ) c
      WHERE u.id = c.id
    `, staleBefore)

    return NextResponse.json({
      success: true,
      message: `Daily stats computed for ${dayStart.toISOString().split('T')[0]}`,
      stats,
      rollup: {
        usersRefreshed: rollupRows,
        durationMs: Date.now() - rollupStart,
        // LIMIT 50000 per run keeps one execution bounded. If this equals the
        // limit there is more to do and the next run will continue — it is not
        // an error, but it IS the signal to move rollups to their own job.
        capped: rollupRows >= 50000,
      },
    })
  } catch (error) {
    console.error('Compute daily stats error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to compute daily stats',    }, { status: 500 })
  }
},
)

/**
 * GET /api/admin/compute-daily-stats
 * Returns the latest daily stats (for dashboard to read).
 * If no stats exist yet, triggers computation.
 */
export const GET = withAdmin(
  'admin/compute-daily-stats',
  async (req: NextRequest, ctx) => {
  try {
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
},
)
