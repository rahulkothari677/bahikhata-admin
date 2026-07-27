import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { clampPageSize, decodeCursor, keysetOrderBy, keysetPaginate, keysetWhere } from '@/lib/pagination'
import { maskEmail, maskName, maskPhone } from '@/lib/pii'

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
export const GET = withAdmin(
  'admin/users',
  async (req: NextRequest, ctx) => {
  try {

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

    // ═══════════════════════════════════════════════════════════════════════
    // 📊 SCALE (audit 2026-07-27). This block previously:
    //
    //  1. Paginated with skip/take -> SQL OFFSET. The database materialises
    //     every skipped row and discards it, so page 5,000 reads five million
    //     rows to return twenty, while holding a connection the shopkeepers'
    //     app needs. Now keyset — page 5,000 costs what page 1 costs.
    //
    //  2. Selected `_count` on four relations, which Prisma compiles to a
    //     correlated subquery PER ROW: 100 subqueries over the transaction
    //     table for one 25-row page. Now reads denormalised columns.
    //
    //  3. Applied minTransactions/minProducts/minParties in JAVASCRIPT, AFTER
    //     fetching the page. That was silently wrong, not merely slow:
    //       - `total` came from an unfiltered count, so paging was nonsense
    //       - pages returned fewer rows than `limit` with no explanation
    //       - a user matching the filter on page 3 was invisible if page 1
    //         was being viewed — the filter only ever saw 20 rows
    //     Those filters are now real WHERE clauses on indexed columns.
    // ═══════════════════════════════════════════════════════════════════════
    if (minTransactions !== null) where.txnCount = { gte: minTransactions }
    if (minProducts !== null) where.productCount = { gte: minProducts }
    if (minParties !== null) where.partyCount = { gte: minParties }

    // Closed accounts are hidden by default; ?includeClosed=true to see them.
    if (p.get('includeClosed') !== 'true') where.deletedAt = null

    const sortOrder = p.get('sortOrder') === 'asc' ? 'asc' : 'desc'
    const pageSize = clampPageSize(p.get('limit'))
    const cursor = decodeCursor(p.get('cursor'))

    // Sorting is restricted to indexed columns. An arbitrary `sortBy` from the
    // query string means any column can be sorted on, including unindexed ones
    // — a guaranteed sequential scan on a large table.
    const SORTABLE = new Set(['createdAt', 'updatedAt'])
    const rawSort = p.get('sortBy') || 'createdAt'
    const sortBy = SORTABLE.has(rawSort) ? rawSort : 'createdAt'

    const page = await keysetPaginate(
      (take) =>
        db.user.findMany({
          where: { ...where, ...keysetWhere(sortBy, cursor, sortOrder) },
          orderBy: keysetOrderBy(sortBy, sortOrder),
          take,
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
            deletedAt: true,
            shops: { select: { name: true, gstin: true, state: true } },
            txnCount: true,
            productCount: true,
            partyCount: true,
            countsUpdatedAt: true,
          },
        }),
      pageSize,
      sortBy,
    )

    return NextResponse.json({
      success: true,
      // Identifiers are MASKED by default. Support agents unmask per-user via
      // /api/admin/users/[id], which is audited; a list view never needs them.
      users: page.rows.map((u) => ({
        ...u,
        email: maskEmail(u.email),
        name: maskName(u.name),
        phone: maskPhone(u.phone),
        // countsUpdatedAt null means the rollup has never run. The UI must
        // render "—", NOT "0" — an uncomputed count is not a count of zero.
        countsStale: u.countsUpdatedAt === null,
      })),
      pagination: {
        pageSize,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
      filters: Object.fromEntries(p.entries()),
    })
  } catch (error) {
    console.error('Admin users fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
},
)
