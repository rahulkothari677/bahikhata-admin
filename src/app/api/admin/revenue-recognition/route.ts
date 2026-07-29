import { NextRequest, NextResponse } from 'next/server'
import { assertPageDepth, PageTooDeepError } from '@/lib/pagination'
import { withAdmin } from '@/lib/with-admin'
import { dbRead } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { getRevenueOverview, getMonthlyBreakdown } from '@/lib/revenue-recognition'

/**
 * GET /api/admin/revenue-recognition
 *
 * Returns revenue recognition analytics (accrual-based).
 *
 * Query params:
 *   - tab: 'overview' | 'schedules' | 'monthly' (default: 'overview')
 *   - status: 'all' | 'pending' | 'current' | 'recognized'
 *   - page: number (default 1)
 *   - months: number (for monthly tab, default 12)
 */
export const GET = withAdmin(
  'admin/revenue-recognition',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const status = url.searchParams.get('status') || 'all'
    const page = assertPageDepth(url.searchParams.get('page'))
    const months = parseInt(url.searchParams.get('months') || '12', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const overview = await getRevenueOverview()

      // Also get current month vs last month for delta
      const monthlyBreakdown = await getMonthlyBreakdown(2)
      const currentMonth = monthlyBreakdown[monthlyBreakdown.length - 1]
      const lastMonth = monthlyBreakdown[monthlyBreakdown.length - 2]

      const recognizedDelta = currentMonth && lastMonth
        ? Math.round(((currentMonth.recognized - lastMonth.recognized) / Math.max(lastMonth.recognized, 1)) * 1000) / 10
        : 0

      return NextResponse.json({
        success: true,
        overview,
        currentMonth: currentMonth || null,
        lastMonth: lastMonth || null,
        recognizedDeltaPct: recognizedDelta,
      })
    }

    // ============ SCHEDULES TAB (paginated list) ============
    if (tab === 'schedules') {
      const skip = (page - 1) * pageSize

      const where: any = {}
      if (status !== 'all') where.status = status

      const [schedules, total] = await Promise.all([
        withTimeout(
          dbRead.revenueSchedule.findMany({
            where,
            orderBy: { periodStart: 'desc' },
            skip,
            take: pageSize,
          }),
          5000
        ).catch(ctx.degrade('revenueSchedule.findMany', [])),
        withTimeout(dbRead.revenueSchedule.count({ where }), 5000).catch(ctx.degrade('revenueSchedule.count', 0)),
      ])

      return NextResponse.json({
        success: true,
        schedules: (schedules as any[]).map((s: any) => ({
          id: s.id,
          subscriptionId: s.subscriptionId,
          userId: s.userId,
          plan: s.plan,
          amount: s.amount,
          periodStart: s.periodStart.toISOString(),
          periodEnd: s.periodEnd.toISOString(),
          status: s.status,
          recognizedAt: s.recognizedAt?.toISOString() || null,
          createdAt: s.createdAt.toISOString(),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      })
    }

    // ============ MONTHLY TAB (chart data) ============
    if (tab === 'monthly') {
      const monthlyBreakdown = await getMonthlyBreakdown(months)

      return NextResponse.json({
        success: true,
        monthly: monthlyBreakdown,
      })
    }

    return NextResponse.json({ error: 'Invalid tab' }, { status: 400 })
  } catch (error) {

    // A page-depth refusal is a CLIENT error carrying a useful message.

    // Re-throw it so withAdmin returns a typed 400; otherwise this

    // handler flattens it into a generic "failed to fetch".

    if (error instanceof PageTooDeepError) throw error
    console.error('Revenue recognition fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch revenue recognition data',    }, { status: 500 })
  }
},
)
