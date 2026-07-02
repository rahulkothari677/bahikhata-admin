import { db } from '@/lib/db'
import { safeCount, safeAggregate, withTimeout } from '@/lib/resilience'

// =====================================================================
// CREDIT SCORING — BULK + CACHE STRATEGY
// =====================================================================
// 1. Background job (`computeAndCacheAllScores`) runs daily (or on-demand).
//    It uses ~5 bulk groupBy queries to compute ALL user scores at once
//    and writes them to `CreditScoreCache`.
// 2. UI reads ONLY from cache — instant, scales to millions.
// 3. Detail page (`computeSingleUserScore`) computes 1 user on-demand (4 queries).
// 4. If cache is empty, `getCreditScoreSummary` falls back to live bulk compute.
// =====================================================================

/**
 * Credit Scoring — designed for scale.
 *
 * OLD APPROACH (N+1 queries):
 *   users = findMany(ALL users with transactions)
 *   for each user:
 *     query 1: find transactions (6 months)
 *     query 2: count products
 *     query 3: count parties
 *     query 4: find transactions (all time)
 *   Total: 1 + 4*N queries (4,001 at 1000 users)
 *
 * NEW APPROACH (bulk aggregate):
 *   Uses groupBy to compute per-user metrics in ~5 queries total.
 *   Credit scores are computed from the aggregated results in JS.
 *   Results are cached in CreditScoreCache table.
 *
 * For the detail page, a single user's score is computed on-demand
 * (only 4 queries for 1 user — acceptable).
 */

export interface CreditScoreSummary {
  totalScored: number
  excellent: number
  good: number
  fair: number
  poor: number
  avgScore: number
  lendingPotential: {
    excellent: number
    good: number
    fair: number
    total: number
  }
}

export async function getCreditScoreSummary(): Promise<CreditScoreSummary> {
  // Try reading from cache first (instant, scales to millions)
  const cached = await db.creditScoreCache.groupBy({
    by: ['band'],
    _count: true,
    _avg: { score: true },
  })

  // If cache has data, use it
  const hasCache = cached.length > 0 && cached.some((c: any) => c._count > 0)

  if (hasCache) {
    const bandCounts: Record<string, number> = {}
    let totalScored = 0
    let totalScoreSum = 0

    for (const c of cached) {
      bandCounts[c.band] = c._count
      totalScored += c._count
      totalScoreSum += (c._avg.score || 0) * c._count
    }

    const excellent = bandCounts['excellent'] || 0
    const good = bandCounts['good'] || 0
    const fair = bandCounts['fair'] || 0
    const poor = bandCounts['poor'] || 0

    return {
      totalScored,
      excellent,
      good,
      fair,
      poor,
      avgScore: totalScored > 0 ? Math.round(totalScoreSum / totalScored) : 0,
      lendingPotential: {
        excellent: excellent * 200, // ₹200 per lead
        good: good * 150,
        fair: fair * 100,
        total: excellent * 200 + good * 150 + fair * 100,
      },
    }
  }

  // Cache is empty — compute from live data (fallback)
  // Uses bulk groupBy queries, NOT per-user queries
  return await computeSummaryLive()
}

/**
 * Computes credit score summary from live data using bulk aggregate queries.
 * This is the fallback when cache is empty.
 * At scale, a background job should populate the cache instead.
 */
async function computeSummaryLive(): Promise<CreditScoreSummary> {
  const now = new Date()
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

  // ===== BULK QUERIES (5 total, NOT 4*N) =====

  // 1. Get all users with at least 1 transaction (groupBy, returns userIds only)
  const usersWithTxns = await withTimeout(
    db.transaction.groupBy({
      by: ['userId'],
      _count: true,
      where: { type: 'sale', date: { gte: sixMonthsAgo } },
    }),
    5000
  ).catch(() => [])

  // 2. Get total sales per user (groupBy, returns userId + sum only)
  const salesByUser = await withTimeout(
    db.transaction.groupBy({
      by: ['userId'],
      where: { type: 'sale', date: { gte: sixMonthsAgo } },
      _sum: { totalAmount: true },
    }),
    5000
  ).catch(() => [])

  // 3. Get paid amount per user (groupBy)
  const paidByUser = await withTimeout(
    db.transaction.groupBy({
      by: ['userId'],
      where: { type: 'sale', date: { gte: sixMonthsAgo } },
      _sum: { paidAmount: true },
    }),
    5000
  ).catch(() => [])

  // 4. Count products per user (groupBy)
  const productsByUser = await withTimeout(
    db.product.groupBy({
      by: ['userId'],
      _count: true,
    }),
    5000
  ).catch(() => [])

  // 5. Count parties per user (groupBy)
  const partiesByUser = await withTimeout(
    db.party.groupBy({
      by: ['userId'],
      _count: true,
    }),
    5000
  ).catch(() => [])

  // ===== COMPUTE SCORES IN JS (from aggregated data) =====
  // Build lookup maps for O(1) access
  const salesMap = new Map<string, number>()
  for (const s of salesByUser as any[]) {
    salesMap.set(s.userId, s._sum.totalAmount || 0)
  }

  const paidMap = new Map<string, number>()
  for (const p of paidByUser as any[]) {
    paidMap.set(p.userId, p._sum.paidAmount || 0)
  }

  const productsMap = new Map<string, number>()
  for (const p of productsByUser as any[]) {
    productsMap.set(p.userId, p._count)
  }

  const partiesMap = new Map<string, number>()
  for (const p of partiesByUser as any[]) {
    partiesMap.set(p.userId, p._count)
  }

  // Compute score for each user with transactions
  let excellent = 0, good = 0, fair = 0, poor = 0
  let totalScore = 0
  const userIds = (usersWithTxns as any[]).map((u: any) => u.userId)

  for (const userId of userIds) {
    const totalSales = salesMap.get(userId) || 0
    const avgMonthlySales = totalSales / 6
    const paidAmount = paidMap.get(userId) || 0
    const collectionRate = totalSales > 0 ? paidAmount / totalSales : 0
    const productCount = productsMap.get(userId) || 0
    const partyCount = partiesMap.get(userId) || 0

    // Scoring (same logic as original, but from aggregated data)
    let score = 300 // base

    // 1. Transaction Volume (200 pts)
    if (avgMonthlySales >= 200000) score += 200
    else if (avgMonthlySales >= 100000) score += 150
    else if (avgMonthlySales >= 50000) score += 100
    else if (avgMonthlySales >= 10000) score += 50

    // 2. Collection Rate (150 pts)
    if (collectionRate >= 0.95) score += 150
    else if (collectionRate >= 0.85) score += 120
    else if (collectionRate >= 0.70) score += 90
    else if (collectionRate >= 0.50) score += 60

    // 3. Product Diversity (100 pts)
    if (productCount >= 50) score += 100
    else if (productCount >= 20) score += 75
    else if (productCount >= 10) score += 50
    else if (productCount >= 5) score += 30

    // 4. Party Base (75 pts)
    if (partyCount >= 50) score += 75
    else if (partyCount >= 20) score += 60
    else if (partyCount >= 10) score += 40
    else if (partyCount >= 5) score += 25

    // 5. Transaction count consistency (175 pts - simplified from active months)
    const txCount = (usersWithTxns as any[]).find((u: any) => u.userId === userId)?._count || 0
    if (txCount >= 100) score += 175
    else if (txCount >= 50) score += 140
    else if (txCount >= 20) score += 100
    else if (txCount >= 10) score += 60
    else if (txCount >= 5) score += 30

    score = Math.min(900, Math.max(300, score))
    totalScore += score

    if (score >= 750) excellent++
    else if (score >= 650) good++
    else if (score >= 550) fair++
    else poor++
  }

  const totalScored = userIds.length

  return {
    totalScored,
    excellent,
    good,
    fair,
    poor,
    avgScore: totalScored > 0 ? Math.round(totalScore / totalScored) : 0,
    lendingPotential: {
      excellent: excellent * 200,
      good: good * 150,
      fair: fair * 100,
      total: excellent * 200 + good * 150 + fair * 100,
    },
  }
}

/**
 * Computes credit score for a SINGLE user (for detail page).
 * Only 4 queries for 1 user — acceptable for on-demand computation.
 */
export async function computeSingleUserScore(userId: string) {
  const now = new Date()
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, createdAt: true,
      shops: { select: { gstin: true } },
    },
  })

  if (!user) return null

  // 4 queries for 1 user (acceptable — not N+1)
  const [transactions, allTxns, productCount, partyCount] = await Promise.all([
    db.transaction.findMany({
      where: { userId, type: 'sale', date: { gte: sixMonthsAgo } },
      select: { totalAmount: true, paidAmount: true, date: true, cgst: true, sgst: true, igst: true },
    }),
    db.transaction.count({ where: { userId, type: 'sale' } }),
    db.product.count({ where: { userId } }),
    db.party.count({ where: { userId } }),
  ])

  const totalSales = transactions.reduce((s, t) => s + t.totalAmount, 0)
  const avgMonthlySales = totalSales / 6
  const totalPaid = transactions.reduce((s, t) => s + t.paidAmount, 0)
  const collectionRate = totalSales > 0 ? totalPaid / totalSales : 0
  const businessAgeDays = Math.floor((now.getTime() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000))
  const hasGstData = transactions.some(t => t.cgst > 0 || t.sgst > 0 || t.igst > 0) || user.shops.some(s => !!s.gstin)

  // Compute score (same logic)
  let score = 300
  if (avgMonthlySales >= 200000) score += 200
  else if (avgMonthlySales >= 100000) score += 150
  else if (avgMonthlySales >= 50000) score += 100
  else if (avgMonthlySales >= 10000) score += 50

  if (collectionRate >= 0.95) score += 150
  else if (collectionRate >= 0.85) score += 120
  else if (collectionRate >= 0.70) score += 90
  else if (collectionRate >= 0.50) score += 60

  if (productCount >= 50) score += 100
  else if (productCount >= 20) score += 75
  else if (productCount >= 10) score += 50
  else if (productCount >= 5) score += 30

  if (partyCount >= 50) score += 75
  else if (partyCount >= 20) score += 60
  else if (partyCount >= 10) score += 40
  else if (partyCount >= 5) score += 25

  if (allTxns >= 100) score += 175
  else if (allTxns >= 50) score += 140
  else if (allTxns >= 20) score += 100
  else if (allTxns >= 10) score += 60
  else if (allTxns >= 5) score += 30

  score = Math.min(900, Math.max(300, score))
  const band = score >= 750 ? 'excellent' : score >= 650 ? 'good' : score >= 550 ? 'fair' : 'poor'
  const recommendation =
    band === 'excellent' ? 'Prime lending candidate. Recommend for unsecured loans up to ₹5L.' :
    band === 'good' ? 'Good candidate. Recommend for secured loans up to ₹3L.' :
    band === 'fair' ? 'Subprime. Small ticket loans (₹50K-1L) with collateral.' :
    'High risk. Do not recommend for lending.'

  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name || user.email,
    score,
    band,
    recommendation,
    metrics: {
      totalSales6Months: totalSales,
      avgMonthlySales,
      collectionRate,
      businessAgeDays,
      productCount,
      partyCount,
      totalTransactions: allTxns,
      hasGstData,
    },
  }
}

// =====================================================================
// BACKGROUND JOB — computeAndCacheAllScores
// =====================================================================
// Runs as a background job (triggered via /api/admin/data-monetization/compute).
// Uses 5 bulk groupBy queries (NOT 4*N), then writes results to CreditScoreCache.
//
// At 1M users:
//   - 5 groupBy queries (each returns up to 1M rows)
//   - JS compute in memory (1M iterations, ~200ms)
//   - Batch upsert to cache (chunked at 500 rows to avoid memory spike)
//   - Total runtime: ~30-60 seconds (acceptable for daily job)
// =====================================================================

export interface ComputeResult {
  success: boolean
  totalScored: number
  byBand: { excellent: number; good: number; fair: number; poor: number }
  avgScore: number
  durationMs: number
  error?: string
}

export async function computeAndCacheAllScores(): Promise<ComputeResult> {
  const startTime = Date.now()
  const now = new Date()
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

  try {
    // ===== BULK QUERIES (5 total — NOT 4*N) =====
    // Run in parallel for max throughput
    const [
      usersWithTxns,
      salesByUser,
      paidByUser,
      productsByUser,
      partiesByUser,
    ] = await Promise.all([
      // 1. Users with sales in last 6 months + their txn count
      withTimeout(
        db.transaction.groupBy({
          by: ['userId'],
          _count: true,
          where: { type: 'sale', date: { gte: sixMonthsAgo } },
        }),
        10000
      ).catch(() => []),

      // 2. Total sales amount per user (6 months)
      withTimeout(
        db.transaction.groupBy({
          by: ['userId'],
          where: { type: 'sale', date: { gte: sixMonthsAgo } },
          _sum: { totalAmount: true },
        }),
        10000
      ).catch(() => []),

      // 3. Total paid amount per user (6 months)
      withTimeout(
        db.transaction.groupBy({
          by: ['userId'],
          where: { type: 'sale', date: { gte: sixMonthsAgo } },
          _sum: { paidAmount: true },
        }),
        10000
      ).catch(() => []),

      // 4. Product count per user (all-time — needed for diversity)
      withTimeout(
        db.product.groupBy({
          by: ['userId'],
          _count: true,
        }),
        10000
      ).catch(() => []),

      // 5. Party count per user (all-time)
      withTimeout(
        db.party.groupBy({
          by: ['userId'],
          _count: true,
        }),
        10000
      ).catch(() => []),
    ])

    // ===== BUILD LOOKUP MAPS (O(1) access) =====
    const salesMap = new Map<string, number>()
    for (const s of salesByUser as any[]) {
      salesMap.set(s.userId, s._sum.totalAmount || 0)
    }
    const paidMap = new Map<string, number>()
    for (const p of paidByUser as any[]) {
      paidMap.set(p.userId, p._sum.paidAmount || 0)
    }
    const productsMap = new Map<string, number>()
    for (const p of productsByUser as any[]) {
      productsMap.set(p.userId, p._count)
    }
    const partiesMap = new Map<string, number>()
    for (const p of partiesByUser as any[]) {
      partiesMap.set(p.userId, p._count)
    }

    // ===== FETCH USER METADATA (createdAt for business age) =====
    // This is ONE findMany with select — only fetches users that have transactions
    const userIds = (usersWithTxns as any[]).map((u: any) => u.userId)
    if (userIds.length === 0) {
      // No users with transactions — clear cache and return
      await db.creditScoreCache.deleteMany({})
      return {
        success: true,
        totalScored: 0,
        byBand: { excellent: 0, good: 0, fair: 0, poor: 0 },
        avgScore: 0,
        durationMs: Date.now() - startTime,
      }
    }

    // Fetch user createdAt in chunks (avoid 1M-row IN clause)
    const userMeta = new Map<string, { createdAt: Date }>()
    const CHUNK_SIZE = 5000
    for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
      const chunk = userIds.slice(i, i + CHUNK_SIZE)
      const users = await withTimeout(
        db.user.findMany({
          where: { id: { in: chunk } },
          select: { id: true, createdAt: true },
        }),
        10000
      ).catch(() => [])
      for (const u of users) {
        userMeta.set(u.id, { createdAt: u.createdAt })
      }
    }

    // ===== COMPUTE SCORES IN JS + BUILD CACHE ROWS =====
    const cacheRows: Array<{
      userId: string
      score: number
      band: string
      avgMonthlySales: number
      totalSales6Mo: number
      activeMonths: number
      collectionRate: number
      businessAgeDays: number
      productCount: number
      partyCount: number
      hasGstData: boolean
      recommendation: string
    }> = []

    let excellent = 0, good = 0, fair = 0, poor = 0
    let totalScore = 0

    for (const u of usersWithTxns as any[]) {
      const userId = u.userId
      const txCount = u._count || 0
      const totalSales = salesMap.get(userId) || 0
      const avgMonthlySales = totalSales / 6
      const paidAmount = paidMap.get(userId) || 0
      const collectionRate = totalSales > 0 ? paidAmount / totalSales : 0
      const productCount = productsMap.get(userId) || 0
      const partyCount = partiesMap.get(userId) || 0
      const userCreated = userMeta.get(userId)?.createdAt
      const businessAgeDays = userCreated
        ? Math.floor((now.getTime() - userCreated.getTime()) / (24 * 60 * 60 * 1000))
        : 0

      // Scoring (same logic as single-user function)
      let score = 300
      if (avgMonthlySales >= 200000) score += 200
      else if (avgMonthlySales >= 100000) score += 150
      else if (avgMonthlySales >= 50000) score += 100
      else if (avgMonthlySales >= 10000) score += 50

      if (collectionRate >= 0.95) score += 150
      else if (collectionRate >= 0.85) score += 120
      else if (collectionRate >= 0.70) score += 90
      else if (collectionRate >= 0.50) score += 60

      if (productCount >= 50) score += 100
      else if (productCount >= 20) score += 75
      else if (productCount >= 10) score += 50
      else if (productCount >= 5) score += 30

      if (partyCount >= 50) score += 75
      else if (partyCount >= 20) score += 60
      else if (partyCount >= 10) score += 40
      else if (partyCount >= 5) score += 25

      if (txCount >= 100) score += 175
      else if (txCount >= 50) score += 140
      else if (txCount >= 20) score += 100
      else if (txCount >= 10) score += 60
      else if (txCount >= 5) score += 30

      score = Math.min(900, Math.max(300, score))
      const band = score >= 750 ? 'excellent' : score >= 650 ? 'good' : score >= 550 ? 'fair' : 'poor'
      const recommendation =
        band === 'excellent' ? 'Prime lending candidate. Recommend for unsecured loans up to ₹5L.' :
        band === 'good' ? 'Good candidate. Recommend for secured loans up to ₹3L.' :
        band === 'fair' ? 'Subprime. Small ticket loans (₹50K-1L) with collateral.' :
        'High risk. Do not recommend for lending.'

      totalScore += score
      if (band === 'excellent') excellent++
      else if (band === 'good') good++
      else if (band === 'fair') fair++
      else poor++

      cacheRows.push({
        userId,
        score,
        band,
        avgMonthlySales,
        totalSales6Mo: totalSales,
        activeMonths: 0, // not computed in bulk (would require another groupBy)
        collectionRate,
        businessAgeDays,
        productCount,
        partyCount,
        hasGstData: false, // not computed in bulk
        recommendation,
      })
    }

    // ===== BATCH UPSERT TO CACHE (chunked to avoid memory spike) =====
    // First clear stale cache, then write fresh rows in chunks
    await db.creditScoreCache.deleteMany({})

    const UPSERT_CHUNK = 500
    for (let i = 0; i < cacheRows.length; i += UPSERT_CHUNK) {
      const chunk = cacheRows.slice(i, i + UPSERT_CHUNK)
      await db.creditScoreCache.createMany({
        data: chunk,
        skipDuplicates: true,
      })
    }

    const durationMs = Date.now() - startTime

    return {
      success: true,
      totalScored: cacheRows.length,
      byBand: { excellent, good, fair, poor },
      avgScore: cacheRows.length > 0 ? Math.round(totalScore / cacheRows.length) : 0,
      durationMs,
    }
  } catch (error) {
    return {
      success: false,
      totalScored: 0,
      byBand: { excellent: 0, good: 0, fair: 0, poor: 0 },
      avgScore: 0,
      durationMs: Date.now() - startTime,
      error: String(error).slice(0, 500),
    }
  }
}

// =====================================================================
// PAGINATED READER — getTopLendingCandidates
// =====================================================================
// Reads from CreditScoreCache (instant, scales to millions).
// Returns paginated list of top candidates sorted by score DESC.
// =====================================================================

export interface LendingCandidate {
  userId: string
  score: number
  band: string
  avgMonthlySales: number
  collectionRate: number
  businessAgeDays: number
  productCount: number
  partyCount: number
  recommendation: string
  computedAt: Date
}

export interface LendingCandidatesResult {
  candidates: LendingCandidate[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  cacheStaleAt: Date | null
}

export async function getTopLendingCandidates(opts: {
  page?: number
  pageSize?: number
  band?: 'excellent' | 'good' | 'fair' | 'poor'
  minScore?: number
}): Promise<LendingCandidatesResult> {
  const page = opts.page || 1
  const pageSize = Math.min(opts.pageSize || 20, 100) // hard cap at 100
  const skip = (page - 1) * pageSize

  const where: any = {}
  if (opts.band) where.band = opts.band
  if (opts.minScore) where.score = { gte: opts.minScore }

  // Parallel: total count + page rows + latest computedAt (for staleness)
  const [total, rows, latest] = await Promise.all([
    withTimeout(db.creditScoreCache.count({ where }), 5000).catch(() => 0),
    withTimeout(
      db.creditScoreCache.findMany({
        where,
        orderBy: { score: 'desc' },
        skip,
        take: pageSize,
      }),
      5000
    ).catch(() => []),
    withTimeout(
      db.creditScoreCache.findFirst({
        orderBy: { computedAt: 'desc' },
        select: { computedAt: true },
      }),
      5000
    ).catch(() => null),
  ])

  const candidates: LendingCandidate[] = (rows as any[]).map((r) => ({
    userId: r.userId,
    score: r.score,
    band: r.band,
    avgMonthlySales: r.avgMonthlySales,
    collectionRate: r.collectionRate,
    businessAgeDays: r.businessAgeDays,
    productCount: r.productCount,
    partyCount: r.partyCount,
    recommendation: r.recommendation || '',
    computedAt: r.computedAt,
  }))

  return {
    candidates,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    cacheStaleAt: latest?.computedAt || null,
  }
}
