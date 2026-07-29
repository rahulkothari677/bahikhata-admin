import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { dbRead } from '@/lib/db'
import { Degradable } from '@/lib/degradable'
import { maskEmail, maskName } from '@/lib/pii'

/**
 * GET /api/admin/overview
 *
 * Returns overview stats + activity feed in ONE API call.
 * Uses only count() and aggregate() — NO row fetching. Scales to millions.
 * Each query is wrapped in try-catch so one failure doesn't crash everything.
 */
export const GET = withAdmin(
  'admin/overview',
  async (req: NextRequest, ctx) => {
  try {

    const now = new Date()
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // ═══════════════════════════════════════════════════════════════════════
    // 🔇 HONEST FAILURE (audit 2026-07-27). These helpers used to be:
    //     try { return await fn() } catch { return 0 }
    //
    // One failing widget should not blank the dashboard — that part was right.
    // But returning 0 makes a FAILURE indistinguishable from a FACT. "1,240
    // users" and "0 users" render identically whether the query succeeded or
    // timed out, so the founder reads a broken dashboard as a healthy business.
    //
    // Degradable still returns the fallback so the page renders, but records
    // WHICH values are fallbacks. The response carries `degraded: [...]` and
    // the UI shows "—" for those instead of a confident zero.
    // ═══════════════════════════════════════════════════════════════════════
    const d = new Degradable(ctx.requestId)
    const count = (name: string, fn: () => Promise<number>) =>
      d.settle(name, fn, 0)
    const agg = (name: string, fn: () => Promise<any>, field: string) =>
      d.settle(name, async () => (await fn())._sum?.[field] || 0, 0)

    // Stats — all aggregate/count queries, no row fetching
    const [
      totalUsers, todayActiveUsers, totalGmv, totalTransactions,
      monthAiCost, payingUsers, monthRevenue, todaySignups, totalAiCalls,
    ] = await Promise.all([
      count('totalUsers', () => dbRead.user.count({ where: { deletedAt: null } })),
      count('todayActiveUsers', () => dbRead.user.count({ where: { updatedAt: { gte: todayStart }, deletedAt: null } })),
      agg('totalGmv', () => dbRead.transaction.aggregate({ _sum: { totalAmount: true } }), 'totalAmount'),
      count('totalTransactions', () => dbRead.transaction.count()),
      agg('monthAiCost', () => dbRead.aiUsageLog.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costInr: true } }), 'costInr'),
      count('payingUsers', () => dbRead.user.count({ where: { plan: { in: ['pro', 'elite'] }, deletedAt: null } })),
      agg('monthRevenue', () => dbRead.subscription.aggregate({ where: { status: 'active' }, _sum: { amount: true } }), 'amount'),
      count('todaySignups', () => dbRead.user.count({ where: { createdAt: { gte: todayStart }, deletedAt: null } })),
      count('totalAiCalls', () => dbRead.aiUsageLog.count()),
    ])

    // Activity feed — bounded queries (take: 10 each, 7-day window)
    let activity: { events: any[]; summary: { total: number } } = { events: [], summary: { total: 0 } }
    try {
      const [recentSignups, recentTransactions, recentAiCalls, recentSubscriptions, recentAdminActions] = await Promise.all([
        dbRead.user.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, email: true, name: true, plan: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        // ⛔ REMOVED (audit 2026-07-27): the per-transaction feed, for the same
        // reason it was removed from /api/admin/activity. It streamed
        // individual shopkeepers' sales and purchases onto the dashboard,
        // attributed by name and email — and a transaction row also identifies
        // the shopkeeper's own customer or supplier, third parties who have no
        // relationship with EkBook. `totalTransactions` above is the number a
        // founder actually needs.
        Promise.resolve([] as any[]),
        dbRead.aiUsageLog.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, feature: true, provider: true, success: true, costInr: true, createdAt: true,
            user: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        dbRead.subscription.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, plan: true, amount: true, status: true, createdAt: true,
            User: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        dbRead.adminAction.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, action: true, description: true, createdAt: true,
            admin: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
      ])

      // Shopkeeper identifiers are MASKED. The admin's OWN email stays intact
      // on admin_action events — an audit trail must attribute actions to the
      // operator who took them.
      const events: any[] = []
      for (const s of recentSignups) events.push({ id: s.id, type: 'signup', timestamp: s.createdAt.toISOString(), title: 'New User Signup', description: `${maskName(s.name) || maskEmail(s.email)} joined (${s.plan})`, icon: '👤', color: 'text-blue-600' })
      for (const a of recentAiCalls) events.push({ id: a.id, type: 'ai_call', timestamp: a.createdAt.toISOString(), title: `🤖 AI ${a.feature.replace('-', ' ')}`, description: `${a.provider} ${a.success ? '✓' : '✗'} ₹${a.costInr.toFixed(2)}`, icon: '🤖', color: 'text-amber-600' })
      for (const s of recentSubscriptions) events.push({ id: s.id, type: 'subscription', timestamp: s.createdAt.toISOString(), title: `👑 ${s.plan.toUpperCase()} Subscription`, description: `₹${s.amount} ${s.status}`, icon: '👑', color: 'text-violet-600' })
      for (const a of recentAdminActions) events.push({ id: a.id, type: 'admin_action', timestamp: a.createdAt.toISOString(), title: '🔒 Admin Action', description: a.description, icon: '🔒', color: 'text-slate-600' })

      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      activity = { events: events.slice(0, 30), summary: { total: events.length } }
    } catch (actErr) {
      // Record it rather than only logging — the client must know the feed is
      // incomplete instead of reading an empty list as "nothing happened".
      d.markFailed('activityFeed', actErr)
    }

    return NextResponse.json({
      success: true,
      ...d.report(),
      stats: {
        totalUsers, todayActiveUsers, totalGmv, totalTransactions,
        monthAiCost, payingUsers, monthRevenue, todaySignups, totalAiCalls,
      },
      activity,
    })
  } catch (error) {
    console.error('Overview API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to load overview data',    }, { status: 500 })
  }
},
)
