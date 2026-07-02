import { db } from '@/lib/db'

/**
 * Segments — designed for scale.
 *
 * OLD APPROACH (N+1 queries):
 *   users = findMany(ALL users)
 *   for each user:
 *     query 1: count transactions
 *     query 2: count AI calls
 *     query 3: sum sales
 *   Total: 1 + 3*N queries (300,001 at 100K users)
 *
 * NEW APPROACH (bulk aggregate):
 *   Use count() and groupBy() to compute segment counts in ~10 queries total.
 *   Each query is a single SQL statement that runs on the database server.
 *   Scales to millions of users with same query count.
 *
 * For the detail page, user lists are fetched with pagination using
 * the segment filter (WHERE clause), not loading all users at once.
 */

export interface SegmentSummary {
  id: string
  name: string
  description: string
  count: number
  color: string
  icon: string
}

export async function getSegmentCounts(): Promise<{ segments: SegmentSummary[]; totalUsers: number }> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Safe query helpers
  const safeCount = async (fn: () => Promise<number>): Promise<number> => {
    try { return await fn() } catch { return 0 }
  }
  const safeGroupBy = async (fn: () => Promise<any>): Promise<any[]> => {
    try { return await fn() as any[] } catch { return [] as any[] }
  }

  // ===== BULK QUERIES (10 total, NOT 3*N) =====
  const [
    totalUsers,
    newUsers,
    atRisk,
    churned,
    freeActive,
    paying,
    abandoned,
    powerUserTxns,
    whaleSales,
    aiPowerUsers,
    risingStarsTxns,
  ] = await Promise.all([
    // 1. Total users (1 query)
    safeCount(() => db.user.count()),

    // 2. New users: signed up in last 7 days (1 query)
    safeCount(() => db.user.count({ where: { createdAt: { gte: sevenDaysAgo } } })),

    // 3. At Risk: active 7-30 days ago, not since (1 query)
    safeCount(() => db.user.count({
      where: {
        updatedAt: { gte: thirtyDaysAgo, lt: sevenDaysAgo },
        createdAt: { lt: sevenDaysAgo },
      },
    })),

    // 4. Churned: no activity in 30+ days (1 query)
    safeCount(() => db.user.count({
      where: {
        updatedAt: { lt: thirtyDaysAgo },
        createdAt: { lt: thirtyDaysAgo },
      },
    })),

    // 5. Free Tier Active: free plan, active in last 7 days (1 query)
    safeCount(() => db.user.count({
      where: { plan: 'free', updatedAt: { gte: sevenDaysAgo } },
    })),

    // 6. Paying Users: pro or elite (1 query)
    safeCount(() => db.user.count({
      where: { plan: { in: ['pro', 'elite'] } },
    })),

    // 7. Trial Abandoned: signed up 7+ days ago, no transactions, no AI calls (1 query)
    // Uses NOT EXISTS subquery — very efficient with indexes
    safeCount(() => db.user.count({
      where: {
        createdAt: { lt: sevenDaysAgo },
        transactions: { none: {} },
        aiUsageLogs: { none: {} },
      },
    })),

    // 8. Power Users: users with 50+ transactions (1 groupBy query)
    // Returns only userId + count, not full user records
    safeGroupBy(() => db.transaction.groupBy({
      by: ['userId'],
      _count: { id: true },
      having: { id: { _count: { gte: 50 } } },
    })),

    // 9. Whales: users with total sales (1 groupBy query)
    // Returns only userId + sum, filter in JS (small result set)
    safeGroupBy(() => db.transaction.groupBy({
      by: ['userId'],
      where: { type: 'sale' },
      _sum: { totalAmount: true },
    })),

    // 10. AI Power Users: 20+ AI calls in last 30 days (1 groupBy query)
    safeGroupBy(() => db.aiUsageLog.groupBy({
      by: ['userId'],
      _count: { id: true },
      where: { createdAt: { gte: thirtyDaysAgo } },
      having: { id: { _count: { gte: 20 } } },
    })),

    // 11. Rising Stars: users with 10+ transactions (for filtering by signup date)
    safeGroupBy(() => db.transaction.groupBy({
      by: ['userId'],
      _count: { id: true },
      having: { id: { _count: { gte: 10 } } },
    })),
  ])

  // ===== COMPUTE SEGMENT COUNTS FROM BULK RESULTS =====

  // Power Users: 50+ transactions AND active in last 7 days
  const powerUserIds = powerUserTxns.map((t: any) => t.userId)
  const powerUsersCount = powerUserIds.length > 0
    ? await safeCount(() => db.user.count({
        where: { id: { in: powerUserIds }, updatedAt: { gte: sevenDaysAgo } },
      }))
    : 0

  // Whales: ₹50K+ total sales (filter groupBy result in JS)
  const whalesCount = whaleSales.filter(
    (s: any) => (s._sum.totalAmount || 0) >= 50000
  ).length

  // AI Power Users: count of groupBy result
  const aiPowerCount = aiPowerUsers.length

  // Rising Stars: 10+ transactions AND signed up in last 7 days
  const risingStarIds = risingStarsTxns.map((t: any) => t.userId)
  const risingStarsCount = risingStarIds.length > 0
    ? await safeCount(() => db.user.count({
        where: { id: { in: risingStarIds }, createdAt: { gte: sevenDaysAgo } },
      }))
    : 0

  // ===== BUILD SEGMENT LIST =====
  const segments: SegmentSummary[] = [
    { id: 'power_users', name: 'Power Users', description: '50+ transactions, active in last 7 days', count: powerUsersCount, color: 'emerald', icon: '⚡' },
    { id: 'whales', name: 'Whales', description: '₹50K+ total sales volume', count: whalesCount, color: 'violet', icon: '🐋' },
    { id: 'new_users', name: 'New Users', description: 'Signed up in last 7 days', count: newUsers, color: 'blue', icon: '🆕' },
    { id: 'at_risk', name: 'At Risk', description: 'Active 7-30 days ago, not since', count: atRisk, color: 'amber', icon: '⚠️' },
    { id: 'churned', name: 'Churned', description: 'No activity in 30+ days', count: churned, color: 'red', icon: '💀' },
    { id: 'ai_power', name: 'AI Power Users', description: '20+ AI calls in last 30 days', count: aiPowerCount, color: 'orange', icon: '🤖' },
    { id: 'free_active', name: 'Free Tier Active', description: 'Free plan, active in last 7 days', count: freeActive, color: 'slate', icon: '🆓' },
    { id: 'paying', name: 'Paying Users', description: 'Pro or Elite plan', count: paying, color: 'amber', icon: '👑' },
    { id: 'abandoned', name: 'Trial Abandoned', description: 'Signed up but never used the app', count: abandoned, color: 'red', icon: '🚫' },
    { id: 'rising_stars', name: 'Rising Stars', description: '10+ transactions in first week', count: risingStarsCount, color: 'emerald', icon: '🌟' },
  ]

  return { segments, totalUsers }
}

// =====================================================================
// DETAIL PAGE: Get paginated users for a specific segment
// Uses WHERE clauses (not N+1) + server-side pagination
// =====================================================================

export async function getSegmentUsers(segmentId: string, page: number = 1, limit: number = 20, search: string = '') {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const skip = (page - 1) * limit

  // Build WHERE clause based on segment
  let where: any = {}

  // Search filter (applied to all segments)
  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ]
  }

  switch (segmentId) {
    case 'new_users':
      where.createdAt = { gte: sevenDaysAgo }
      break
    case 'at_risk':
      where.updatedAt = { gte: thirtyDaysAgo, lt: sevenDaysAgo }
      where.createdAt = { lt: sevenDaysAgo }
      break
    case 'churned':
      where.updatedAt = { lt: thirtyDaysAgo }
      where.createdAt = { lt: thirtyDaysAgo }
      break
    case 'free_active':
      where.plan = 'free'
      where.updatedAt = { gte: sevenDaysAgo }
      break
    case 'paying':
      where.plan = { in: ['pro', 'elite'] }
      break
    case 'abandoned':
      where.createdAt = { lt: sevenDaysAgo }
      where.transactions = { none: {} }
      where.aiUsageLogs = { none: {} }
      break
    // For segments that require groupBy (power_users, whales, ai_power, rising_stars),
    // we first get the user IDs, then query with WHERE id IN (...)
    case 'power_users': {
      const txns = await db.transaction.groupBy({
        by: ['userId'], _count: { id: true }, having: { id: { _count: { gte: 50 } } },
      })
      where.id = { in: txns.map((t: any) => t.userId) }
      where.updatedAt = { gte: sevenDaysAgo }
      break
    }
    case 'whales': {
      const sales = await db.transaction.groupBy({
        by: ['userId'], where: { type: 'sale' }, _sum: { totalAmount: true },
      })
      where.id = { in: sales.filter((s: any) => (s._sum.totalAmount || 0) >= 50000).map((s: any) => s.userId) }
      break
    }
    case 'ai_power': {
      const aiUsers = await db.aiUsageLog.groupBy({
        by: ['userId'], _count: { id: true }, where: { createdAt: { gte: thirtyDaysAgo } },
        having: { id: { _count: { gte: 20 } } },
      })
      where.id = { in: aiUsers.map((a: any) => a.userId) }
      break
    }
    case 'rising_stars': {
      const txns = await db.transaction.groupBy({
        by: ['userId'], _count: { id: true }, having: { id: { _count: { gte: 10 } } },
      })
      where.id = { in: txns.map((t: any) => t.userId) }
      where.createdAt = { gte: sevenDaysAgo }
      break
    }
    default:
      break
  }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, plan: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    db.user.count({ where }),
  ])

  return {
    users: users.map(u => ({ ...u, name: u.name || u.email })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}
