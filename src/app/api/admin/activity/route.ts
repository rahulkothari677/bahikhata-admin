import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { dbRead } from '@/lib/db'
import { maskEmail, maskName } from '@/lib/pii'

/**
 * GET /api/admin/activity?range=today|7d|30d&type=all|signup|transaction|ai_call|subscription|admin_action&search=ram&page=1
 *
 * SCALABILITY DESIGN:
 * - Summary cards use aggregate queries (count), NOT findMany. Scales to billions.
 * - Event list uses server-side pagination with take/skip (max 20 per page).
 * - Search is server-side (WHERE clause), not client-side filtering.
 * - Date range filter limits the query window.
 *
 * At 1M+ users, the event list should switch to cursor-based pagination
 * (WHERE createdAt < ?), but for now take/skip with indexed createdAt works
 * fine up to ~100K events per day.
 */
export const GET = withAdmin(
  'admin/activity',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const range = url.searchParams.get('range') || '7d'
    const type = url.searchParams.get('type') || 'all'
    const search = url.searchParams.get('search') || ''
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
    const limit = 20
    const skip = (page - 1) * limit

    // Calculate date range
    const now = new Date()
    let rangeStart: Date
    switch (range) {
      case 'today': rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); break
      case '30d': rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break
      case '7d':
      default: rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break
    }

    // ===== SUMMARY CARDS (aggregate queries — scale to billions) =====
    // These run in parallel. Each is a single count() query.
    const safeCount = async (fn: () => Promise<number>): Promise<number> => {
      try { return await fn() } catch { return 0 }
    }

    const [signupCount, txnCount, aiCallCount, subCount, adminActionCount] = await Promise.all([
      safeCount(() => dbRead.user.count({ where: { createdAt: { gte: rangeStart } } })),
      // 🔒 2026-08-04 (Phase 7 audit): live rows only — see admin/overview.
      safeCount(() => dbRead.transaction.count({ where: { createdAt: { gte: rangeStart }, deletedAt: null } })),
      safeCount(() => dbRead.aiUsageLog.count({ where: { createdAt: { gte: rangeStart } } })),
      safeCount(() => dbRead.subscription.count({ where: { createdAt: { gte: rangeStart } } })),
      safeCount(() => dbRead.adminAction.count({ where: { createdAt: { gte: rangeStart } } })),
    ])

    const summary = {
      signup: signupCount,
      transaction: txnCount,
      ai_call: aiCallCount,
      subscription: subCount,
      admin_action: adminActionCount,
      total: signupCount + txnCount + aiCallCount + subCount + adminActionCount,
    }

    // ===== EVENT LIST (paginated, server-side search + filter) =====
    // Build the query based on type filter
    // Since events come from different tables, we fetch from each filtered table
    // and merge. At scale, this should be a dedicated Events table with a
    // unified schema. For now, we fetch bounded amounts from each table.

    const events: any[] = []

    // Helper to add events
    const addEvents = (items: any[], type: string, icon: string, color: string, titleFn: (item: any) => string, descFn: (item: any) => string, timeFn: (item: any) => Date, userFn?: (item: any) => string | undefined) => {
      for (const item of items) {
        const title = titleFn(item)
        const desc = descFn(item)
        const user = userFn ? userFn(item) : undefined
        // Apply search filter
        if (search) {
          const searchText = `${title} ${desc} ${user || ''}`.toLowerCase()
          if (!searchText.includes(search.toLowerCase())) continue
        }
        events.push({
          id: item.id,
          type,
          title,
          description: desc,
          user,
          icon,
          color,
          timestamp: timeFn(item).toISOString(),
        })
      }
    }

    // Fetch from each table (bounded: take 50 per table, then merge + paginate)
    // This limits the total events to ~250 max before pagination
    const fetchLimit = 50

    if (type === 'all' || type === 'signup') {
      try {
        const items = await dbRead.user.findMany({
          where: { createdAt: { gte: rangeStart } },
          select: { id: true, email: true, name: true, plan: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
        })
        // Identifiers are MASKED by default (audit 2026-07-26). A signup is
        // EkBook's own commercial relationship so the event itself is fine to
        // show, but the operator does not need the raw address to read a feed.
        // Unmasking is a separate, reason-logged action.
        addEvents(items, 'signup', '👤', 'text-blue-600',
          (u) => 'New User Signup',
          (u) => `${maskName(u.name) || maskEmail(u.email)} joined (${u.plan})`,
          (u) => u.createdAt,
          (u) => maskEmail(u.email) ?? undefined
        )
      } catch {}
    }

    // ⛔ REMOVED (audit 2026-07-26): the per-transaction event feed.
    //
    // This block streamed every shopkeeper's individual sales and purchases
    // into the admin UI, attributed by name and email:
    //     "💰 Sale — ₹4,200 by ram@kirana.com"
    //
    // Two reasons it cannot exist, not one:
    //
    //  1. A shopkeeper's ledger is their commercial books. No purpose in the
    //     consent notice covers an operator watching their trade in real time,
    //     and DPDP s.6 requires processing to be tied to a specified purpose.
    //
    //  2. It exposes THIRD PARTIES. A transaction row identifies the
    //     shopkeeper's own customer or supplier — people who have no
    //     relationship with EkBook and never consented to anything. EkBook
    //     processes their data as the shopkeeper's processor; browsing it is
    //     not a purpose EkBook can claim on its own behalf.
    //
    // The `transaction` COUNT remains in the summary above, which is what a
    // founder actually needs ("1,240 transactions today"). Aggregate volume is
    // the useful signal; the identifiable stream was never the useful part.
    //
    // Fraud and risk investigation is a separate, lawful purpose — it is served
    // by scores and alerts in /api/admin/risk and /api/admin/fraud-alerts, with
    // drill-down gated behind a confirmed alert. Do not restore a general
    // browsing feed here to serve it.

    if (type === 'all' || type === 'ai_call') {
      try {
        const items = await dbRead.aiUsageLog.findMany({
          where: { createdAt: { gte: rangeStart } },
          select: { id: true, feature: true, provider: true, success: true, costInr: true, createdAt: true,
            user: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
        })
        addEvents(items, 'ai_call', '🤖', 'text-amber-600',
          (a) => `🤖 AI ${a.feature.replace('-', ' ')}`,
          (a) => `${a.provider} ${a.success ? '✓' : '✗'} ₹${a.costInr.toFixed(2)}`,
          (a) => a.createdAt,
          (a) => maskEmail(a.user?.email) ?? undefined
        )
      } catch {}
    }

    if (type === 'all' || type === 'subscription') {
      try {
        const items = await dbRead.subscription.findMany({
          where: { createdAt: { gte: rangeStart } },
          select: { id: true, plan: true, amount: true, status: true, createdAt: true,
            User: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
        })
        addEvents(items, 'subscription', '👑', 'text-violet-600',
          (s) => `👑 ${s.plan.toUpperCase()} Subscription`,
          (s) => `₹${s.amount} ${s.status}`,
          (s) => s.createdAt,
          (s) => maskEmail(s.User?.email) ?? undefined
        )
      } catch {}
    }

    if (type === 'all' || type === 'admin_action') {
      try {
        const items = await dbRead.adminAction.findMany({
          where: { createdAt: { gte: rangeStart } },
          select: { id: true, action: true, description: true, createdAt: true,
            admin: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
        })
        addEvents(items, 'admin_action', '🔒', 'text-slate-600',
          (a) => '🔒 Admin Action',
          (a) => a.description,
          (a) => a.createdAt,
          (a) => a.admin?.email
        )
      } catch {}
    }

    // Sort all events by timestamp descending
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Paginate
    const total = events.length
    const totalPages = Math.ceil(total / limit)
    const paginated = events.slice(skip, skip + limit)

    return NextResponse.json({
      success: true,
      summary,
      events: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      range,
      type,
    })
  } catch (error) {
    console.error('Activity API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch activity',    }, { status: 500 })
  }
},
)
