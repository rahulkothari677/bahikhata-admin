import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/users
 *
 * Returns a paginated list of all users with summary stats.
 * Supports search and filtering.
 *
 * Query params:
 *   ?search=ram        — search by email or name
 *   ?plan=free|pro|elite
 *   ?page=1            — page number (default 1)
 *   ?limit=20          — items per page (max 100)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const search = url.searchParams.get('search') || ''
    const plan = url.searchParams.get('plan')
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Number(url.searchParams.get('limit') || '20'))
    const skip = (page - 1) * limit

    const where: any = {}
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (plan && ['free', 'pro', 'elite'].includes(plan)) {
      where.plan = plan
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          plan: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          renewsAt: true,
          cancelledAt: true,
          _count: {
            select: {
              transactions: true,
              products: true,
              parties: true,
              aiUsageLogs: true,
            },
          },
        },
      }),
      db.user.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Admin users fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
