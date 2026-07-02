import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/support
 *
 * Returns support ticket analytics using BULK aggregate + groupBy queries.
 * Scales to millions of tickets — NO findMany on full tables.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'list')
 *   - status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'all'
 *   - priority: 'urgent' | 'high' | 'medium' | 'low' | 'all'
 *   - category: string | 'all'
 *   - search: string (search by subject, message, user email/name)
 *   - page: number (default 1)
 *   - limit: number (default 20, max 100)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'
    const status = url.searchParams.get('status')
    const priority = url.searchParams.get('priority')
    const category = url.searchParams.get('category')
    const search = url.searchParams.get('search') || ''
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Number(url.searchParams.get('limit') || '20'))

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      // 6 parallel count + groupBy queries — all O(1)
      const [
        openCount,
        inProgressCount,
        resolvedCount,
        closedCount,
        urgentCount,
        categoryDist,
      ] = await Promise.all([
        withTimeout(
          db.supportTicket.count({ where: { status: 'open' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.supportTicket.count({ where: { status: 'in_progress' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.supportTicket.count({ where: { status: 'resolved' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.supportTicket.count({ where: { status: 'closed' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.supportTicket.count({ where: { priority: 'urgent', status: { in: ['open', 'in_progress'] } } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.supportTicket.groupBy({
            by: ['category'],
            where: { status: { in: ['open', 'in_progress'] } },
            _count: true,
            orderBy: { _count: { category: 'desc' } },
          }),
          5000
        ).catch(() => []),
      ])

      // Recent tickets created in last 7 days (growth signal)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const newTickets7d = await withTimeout(
        db.supportTicket.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        5000
      ).catch(() => 0)

      return NextResponse.json({
        success: true,
        overview: {
          openCount,
          inProgressCount,
          resolvedCount,
          closedCount,
          urgentCount,
          newTickets7d,
          activeTotal: openCount + inProgressCount,
          resolvedTotal: resolvedCount + closedCount,
        },
        categoryDistribution: (categoryDist as any[]).map((c: any) => ({
          category: c.category,
          count: c._count,
        })),
      })
    }

    // ============ LIST TAB (paginated + searchable + filterable) ============
    const where: any = {}
    if (status && status !== 'all') where.status = status
    if (priority && priority !== 'all') where.priority = priority
    if (category && category !== 'all') where.category = category
    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ]
    }

    const [tickets, total] = await Promise.all([
      withTimeout(
        db.supportTicket.findMany({
          where,
          orderBy: [
            { priority: 'desc' },
            { createdAt: 'desc' },
          ],
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { id: true, email: true, name: true, phone: true, plan: true } },
          },
        }),
        5000
      ).catch(() => []),
      withTimeout(
        db.supportTicket.count({ where }),
        5000
      ).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      tickets: (tickets as any[]).map((t: any) => ({
        id: t.id,
        subject: t.subject,
        message: t.message,
        category: t.category,
        priority: t.priority,
        status: t.status,
        response: t.response,
        resolvedAt: t.resolvedAt?.toISOString() || null,
        resolvedBy: t.resolvedBy,
        assignedTo: t.assignedTo,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        user: t.user,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    })
  } catch (error) {
    console.error('Support tickets fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch tickets',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/support
 * Create a ticket manually (admin creating on behalf of user)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { userId, subject, message, category, priority } = body

    const ticket = await db.supportTicket.create({
      data: {
        userId,
        subject,
        message,
        category: category || 'general',
        priority: priority || 'medium',
        status: 'open',
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'support_ticket_create',
      description: `Created support ticket for user ${userId}`,
      targetType: 'support_ticket',
      targetId: ticket.id,
    })

    return NextResponse.json({ success: true, ticket })
  } catch (error) {
    console.error('Create ticket error:', error)
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
  }
}
