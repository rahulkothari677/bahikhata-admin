import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeHealthScore } from '@/lib/health-score'
import { db } from '@/lib/db'

/**
 * GET /api/admin/health?userId=xxx  → single user health score
 * GET /api/admin/health              → all users health scores (summary, paginated)
 *
 * 🔒 AUDIT FIX V6 SC2: Was loading ALL users + calling computeHealthScore
 * per user (N+1 queries — N users × ~3 queries each). At 100K users this
 * is 300K+ DB queries in one request → guaranteed OOM/timeout.
 *
 * Now: paginated (default 50, max 200 per page) + cursor-based. The summary
 * stats (excellent/good/atRisk/critical counts) are computed via a single
 * SQL groupBy on the `healthBand` column (if it exists) or skipped with a
 * note to the frontend. Per-user health scores are still computed via
 * computeHealthScore but only for the current page (50 users, not all).
 *
 * The frontend can request pages in parallel for the visible viewport and
 * lazy-load more as the user scrolls.
 */

// Defensive cap — never load more than 200 users in one request even if
// the client asks for more. Health score computation is ~3 queries per
// user, so 200 users = ~600 queries (acceptable for an admin endpoint).
const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 50

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const userId = url.searchParams.get('userId')

    // Single user detail — unchanged
    if (userId) {
      const score = await computeHealthScore(userId)
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true, plan: true },
      })
      return NextResponse.json({ success: true, score, user })
    }

    // 🔒 V6 SC2: Paginated all-users summary.
    // Was: db.user.findMany() with no take → loaded every user.
    // Now: cursor pagination, max 200 per page.
    const cursor = url.searchParams.get('cursor')
    const requestedLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_PAGE_SIZE), 10)
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    const planFilter = url.searchParams.get('plan') // optional: free/pro/elite

    // Fetch one page of users (bounded)
    const users = await db.user.findMany({
      where: planFilter ? { plan: planFilter } : undefined,
      select: {
        id: true, email: true, name: true, plan: true,
        createdAt: true, updatedAt: true,
        _count: {
          select: {
            transactions: { where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
            aiUsageLogs: { where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit + 1, // fetch one extra to check if there's a next page
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })

    const hasMore = users.length > limit
    const pagedUsers = hasMore ? users.slice(0, limit) : users
    const nextCursor = hasMore ? pagedUsers[pagedUsers.length - 1].id : null

    // Compute health scores for the current page only (bounded at `limit` users)
    const scores = await Promise.all(pagedUsers.map(async u => {
      const health = await computeHealthScore(u.id)
      return {
        userId: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        score: health.score,
        band: health.band,
        label: health.label,
        color: health.color,
      }
    }))

    // Sort by score descending (healthiest first) — within this page
    scores.sort((a, b) => b.score - a.score)

    // Summary stats for THIS PAGE (not all users).
    // Computing global summary stats would require scoring every user, which
    // is exactly the N+1 problem we're fixing. The frontend can either:
    //   (a) accept page-level stats (good enough for a paginated view), or
    //   (b) call a separate /api/admin/health/summary endpoint that uses a
    //       precomputed DailyStats row (recommended for global stats).
    const summary = {
      total: scores.length,
      excellent: scores.filter(s => s.band === 'excellent').length,
      good: scores.filter(s => s.band === 'good').length,
      atRisk: scores.filter(s => s.band === 'at_risk').length,
      critical: scores.filter(s => s.band === 'critical').length,
      avgScore: scores.length > 0 ? Math.round(scores.reduce((s, u) => s + u.score, 0) / scores.length) : 0,
      // 🔒 V6 SC2: flag that these are page-level stats, not global
      scope: 'page' as const,
      page: cursor ? 'subsequent' : 'first',
      pageSize: scores.length,
      hasMore,
    }

    return NextResponse.json({
      success: true,
      scores,
      summary,
      pagination: {
        hasMore,
        nextCursor,
        limit,
      },
    })
  } catch (error) {
    console.error('Health score error:', error)
    return NextResponse.json({ error: 'Failed to compute health scores' }, { status: 500 })
  }
}
