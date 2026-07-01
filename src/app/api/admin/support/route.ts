import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/support
 * Returns all support tickets with filters.
 * Query: ?status=open&priority=high&category=bug&page=1&limit=20
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const priority = url.searchParams.get('priority')
    const category = url.searchParams.get('category')
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Number(url.searchParams.get('limit') || '20'))

    const where: any = {}
    if (status) where.status = status
    if (priority) where.priority = priority
    if (category) where.category = category

    const [tickets, total] = await Promise.all([
      db.supportTicket.findMany({
        where,
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { email: true, name: true, phone: true, plan: true } },
        },
      }),
      db.supportTicket.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      tickets,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Support tickets fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
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

    return NextResponse.json({ success: true, ticket })
  } catch (error) {
    console.error('Create ticket error:', error)
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
  }
}
