import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/activity
 *
 * Returns a unified activity feed of recent events across the app:
 *   - User signups
 *   - Transactions created
 *   - AI calls (scans + voice)
 *   - Subscription activations
 *   - Admin actions
 *
 * All merged into one timeline, sorted by time descending.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Fetch recent events in parallel
    const [recentSignups, recentTransactions, recentAiCalls, recentSubscriptions, recentAdminActions] = await Promise.all([
      // Signups
      db.user.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { id: true, email: true, name: true, plan: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Transactions
      db.transaction.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { id: true, type: true, totalAmount: true, userId: true, createdAt: true,
          user: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // AI calls
      db.aiUsageLog.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { id: true, feature: true, provider: true, success: true, costInr: true, createdAt: true,
          user: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Subscriptions
      db.subscription.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { id: true, plan: true, amount: true, status: true, createdAt: true,
          User: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Admin actions
      db.adminAction.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { id: true, action: true, description: true, createdAt: true,
          admin: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

    // Merge into unified timeline
    type ActivityEvent = {
      id: string
      type: 'signup' | 'transaction' | 'ai_call' | 'subscription' | 'admin_action'
      timestamp: Date
      title: string
      description: string
      user?: string
      icon: string
      color: string
    }

    const events: ActivityEvent[] = []

    for (const s of recentSignups) {
      events.push({
        id: s.id, type: 'signup', timestamp: s.createdAt,
        title: 'New User Signup',
        description: `${s.name || s.email} joined (${s.plan})`,
        user: s.email, icon: '👤', color: 'text-blue-600',
      })
    }

    for (const t of recentTransactions) {
      events.push({
        id: t.id, type: 'transaction', timestamp: t.createdAt,
        title: `${t.type === 'sale' ? '💰 Sale' : t.type === 'purchase' ? '🛒 Purchase' : '📋 Transaction'}`,
        description: `₹${t.totalAmount.toFixed(0)} by ${t.user?.name || t.user?.email || 'unknown'}`,
        user: t.user?.email, icon: '💰', color: 'text-emerald-600',
      })
    }

    for (const a of recentAiCalls) {
      events.push({
        id: a.id, type: 'ai_call', timestamp: a.createdAt,
        title: `🤖 AI ${a.feature.replace('-', ' ')}`,
        description: `${a.provider} ${a.success ? '✓' : '✗'} ₹${a.costInr.toFixed(2)} by ${a.user?.email || 'unknown'}`,
        user: a.user?.email, icon: '🤖', color: 'text-amber-600',
      })
    }

    for (const s of recentSubscriptions) {
      events.push({
        id: s.id, type: 'subscription', timestamp: s.createdAt,
        title: `👑 ${s.plan.toUpperCase()} Subscription`,
        description: `₹${s.amount} ${s.status} — ${s.User?.email || 'unknown'}`,
        user: s.User?.email, icon: '👑', color: 'text-violet-600',
      })
    }

    for (const a of recentAdminActions) {
      events.push({
        id: a.id, type: 'admin_action', timestamp: a.createdAt,
        title: '🔒 Admin Action',
        description: a.description,
        user: a.admin?.email, icon: '🔒', color: 'text-slate-600',
      })
    }

    // Sort by timestamp descending
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    return NextResponse.json({
      success: true,
      events: events.slice(0, 30).map(e => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
      summary: {
        signups: recentSignups.length,
        transactions: recentTransactions.length,
        aiCalls: recentAiCalls.length,
        subscriptions: recentSubscriptions.length,
        adminActions: recentAdminActions.length,
        total: events.length,
      },
    })
  } catch (error) {
    console.error('Activity feed error:', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }
}
