import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/overview
 *
 * Returns overview stats + activity feed in ONE API call.
 * Uses only count() and aggregate() — NO row fetching. Scales to millions.
 * Each query is wrapped in try-catch so one failure doesn't crash everything.
 */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.error

    const now = new Date()
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Safe query helpers — return 0/null on error instead of crashing
    const safeCount = async (fn: () => Promise<number>): Promise<number> => {
      try { return await fn() } catch { return 0 }
    }
    const safeAgg = async (fn: () => Promise<any>, field: string): Promise<number> => {
      try { const r = await fn(); return r._sum?.[field] || 0 } catch { return 0 }
    }

    // Stats — all aggregate/count queries, no row fetching
    const [
      totalUsers, todayActiveUsers, totalGmv, totalTransactions,
      monthAiCost, payingUsers, monthRevenue, todaySignups, totalAiCalls,
    ] = await Promise.all([
      safeCount(() => db.user.count()),
      safeCount(() => db.user.count({ where: { updatedAt: { gte: todayStart } } })),
      safeAgg(() => db.transaction.aggregate({ _sum: { totalAmount: true } }), 'totalAmount'),
      safeCount(() => db.transaction.count()),
      safeAgg(() => db.aiUsageLog.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costInr: true } }), 'costInr'),
      safeCount(() => db.user.count({ where: { plan: { in: ['pro', 'elite'] } } })),
      safeAgg(() => db.subscription.aggregate({ where: { status: 'active' }, _sum: { amount: true } }), 'amount'),
      safeCount(() => db.user.count({ where: { createdAt: { gte: todayStart } } })),
      safeCount(() => db.aiUsageLog.count()),
    ])

    // Activity feed — bounded queries (take: 10 each, 7-day window)
    let activity: { events: any[]; summary: { total: number } } = { events: [], summary: { total: 0 } }
    try {
      const [recentSignups, recentTransactions, recentAiCalls, recentSubscriptions, recentAdminActions] = await Promise.all([
        db.user.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, email: true, name: true, plan: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        db.transaction.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, type: true, totalAmount: true, createdAt: true,
            user: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        db.aiUsageLog.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, feature: true, provider: true, success: true, costInr: true, createdAt: true,
            user: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        db.subscription.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, plan: true, amount: true, status: true, createdAt: true,
            User: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        db.adminAction.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { id: true, action: true, description: true, createdAt: true,
            admin: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
      ])

      const events: any[] = []
      for (const s of recentSignups) events.push({ id: s.id, type: 'signup', timestamp: s.createdAt.toISOString(), title: 'New User Signup', description: `${s.name || s.email} joined (${s.plan})`, icon: '👤', color: 'text-blue-600' })
      for (const t of recentTransactions) events.push({ id: t.id, type: 'transaction', timestamp: t.createdAt.toISOString(), title: `${t.type === 'sale' ? '💰 Sale' : t.type === 'purchase' ? '🛒 Purchase' : '📋 Transaction'}`, description: `₹${t.totalAmount.toFixed(0)} by ${t.user?.name || t.user?.email || 'unknown'}`, icon: '💰', color: 'text-emerald-600' })
      for (const a of recentAiCalls) events.push({ id: a.id, type: 'ai_call', timestamp: a.createdAt.toISOString(), title: `🤖 AI ${a.feature.replace('-', ' ')}`, description: `${a.provider} ${a.success ? '✓' : '✗'} ₹${a.costInr.toFixed(2)}`, icon: '🤖', color: 'text-amber-600' })
      for (const s of recentSubscriptions) events.push({ id: s.id, type: 'subscription', timestamp: s.createdAt.toISOString(), title: `👑 ${s.plan.toUpperCase()} Subscription`, description: `₹${s.amount} ${s.status}`, icon: '👑', color: 'text-violet-600' })
      for (const a of recentAdminActions) events.push({ id: a.id, type: 'admin_action', timestamp: a.createdAt.toISOString(), title: '🔒 Admin Action', description: a.description, icon: '🔒', color: 'text-slate-600' })

      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      activity = { events: events.slice(0, 30), summary: { total: events.length } }
    } catch (actErr) {
      console.error('Activity feed error (non-fatal):', actErr)
    }

    return NextResponse.json({
      success: true,
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
      error: 'Failed to load overview data',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
