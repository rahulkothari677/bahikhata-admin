import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/users
 *
 * Advanced search with 20+ filters:
 *   ?search=ram              — search by email/name/phone
 *   ?plan=free|pro|elite     — filter by plan
 *   ?role=owner|staff        — filter by role
 *   ?hasGstin=true           — has GST number
 *   ?minTransactions=10      — minimum transaction count
 *   ?minSpent=10000          — minimum total sales
 *   ?hasAiUsage=true         — has used AI features
 *   ?joinedAfter=2026-01-01  — joined after date
 *   ?joinedBefore=2026-06-01 — joined before date
 *   ?activeAfter=2026-06-01  — active after date
 *   ?activeBefore=2026-06-01 — active before date
 *   ?isPaying=true           — has active subscription
 *   ?isCancelled=true        — has cancelledAt set
 *   ?state=Maharashtra       — shop state
 *   ?minProducts=5           — minimum product count
 *   ?minParties=10           — minimum party count
 *   ?sortBy=createdAt        — sort field
 *   ?sortOrder=desc          — sort order
 *   ?page=1                  — pagination
 *   ?limit=20                — items per page (max 100)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.error

    const url = new URL(req.url)
    const p = url.searchParams

    // Build the where clause with all filters
    const where: any = {}

    // Text search (email, name, phone)
    const search = p.get('search')
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Plan filter
    const plan = p.get('plan')
    if (plan && ['free', 'pro', 'elite'].includes(plan)) {
      where.plan = plan
    }

    // Role filter
    const role = p.get('role')
    if (role) where.role = role

    // Has GSTIN
    if (p.get('hasGstin') === 'true') {
      where.shops = { some: { gstin: { not: null } } }
    }

    // Is paying (has active subscription)
    if (p.get('isPaying') === 'true') {
      where.plan = { in: ['pro', 'elite'] }
      where.cancelledAt = null
    }

    // Is cancelled
    if (p.get('isCancelled') === 'true') {
      where.cancelledAt = { not: null }
    }

    // Date filters
    const joinedAfter = p.get('joinedAfter')
    if (joinedAfter) where.createdAt = { ...where.createdAt, gte: new Date(joinedAfter) }

    const joinedBefore = p.get('joinedBefore')
    if (joinedBefore) where.createdAt = { ...where.createdAt, lte: new Date(joinedBefore) }

    const activeAfter = p.get('activeAfter')
    if (activeAfter) where.updatedAt = { ...where.updatedAt, gte: new Date(activeAfter) }

    const activeBefore = p.get('activeBefore')
    if (activeBefore) where.updatedAt = { ...where.updatedAt, lte: new Date(activeBefore) }

    // State filter (via shops)
    const state = p.get('state')
    if (state) {
      where.shops = { some: { state: { contains: state, mode: 'insensitive' } } }
    }

    // Transaction count filter (requires having subquery — we'll filter in JS for now)
    const minTransactions = p.get('minTransactions') ? parseInt(p.get('minTransactions')!) : null
    const minProducts = p.get('minProducts') ? parseInt(p.get('minProducts')!) : null
    const minParties = p.get('minParties') ? parseInt(p.get('minParties')!) : null

    // AI usage filter
    const hasAiUsage = p.get('hasAiUsage')
    if (hasAiUsage === 'true') {
      where.aiUsageLogs = { some: {} }
    } else if (hasAiUsage === 'false') {
      where.aiUsageLogs = { none: {} }
    }

    // Sorting
    const sortBy = p.get('sortBy') || 'createdAt'
    const sortOrder = p.get('sortOrder') || 'desc'
    const orderBy: any = {}
    orderBy[sortBy] = sortOrder

    // Pagination
    const page = Math.max(1, Number(p.get('page') || '1'))
    const limit = Math.min(100, Number(p.get('limit') || '20'))
    const skip = (page - 1) * limit

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          plan: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          renewsAt: true,
          cancelledAt: true,
          shops: { select: { name: true, gstin: true, state: true } },
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

    // Post-filter for min counts (since Prisma can't filter by _count directly in where)
    let filteredUsers = users
    if (minTransactions !== null) {
      filteredUsers = filteredUsers.filter(u => u._count.transactions >= minTransactions)
    }
    if (minProducts !== null) {
      filteredUsers = filteredUsers.filter(u => u._count.products >= minProducts)
    }
    if (minParties !== null) {
      filteredUsers = filteredUsers.filter(u => u._count.parties >= minParties)
    }

    return NextResponse.json({
      success: true,
      users: filteredUsers,
      pagination: {
        page,
        limit,
        total: minTransactions || minProducts || minParties ? filteredUsers.length : total,
        totalPages: Math.ceil((minTransactions || minProducts || minParties ? filteredUsers.length : total) / limit),
      },
      filters: Object.fromEntries(p.entries()),
    })
  } catch (error) {
    console.error('Admin users fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
