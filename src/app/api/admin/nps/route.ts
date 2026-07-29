import { NextRequest, NextResponse } from 'next/server'
import { assertPageDepth, PageTooDeepError } from '@/lib/pagination'
import { withAdmin } from '@/lib/with-admin'
import { dbRead } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

/**
 * GET /api/admin/nps
 *
 * Returns NPS feedback analytics using BULK count + aggregate queries.
 * Scales to millions of responses — NO findMany on full tables.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - page: number (for list tab)
 *   - search: string (search by user email/name or feedback text)
 *   - category: 'all' | 'promoter' | 'passive' | 'detractor' (filter for list tab)
 *
 * OLD APPROACH (buggy + unbounded):
 *   - findMany(take: 50) — only first 50 responses ever visible
 *   - NPS computed in JS from those 50 only — wrong if >50 responses
 *   - Promoter/passive/detractor counts via JS filter — inefficient
 *
 * NEW APPROACH (bulk aggregate):
 *   - 4 parallel count() for promoter/passive/detractor/total (DB-side, O(1))
 *   - 1 aggregate for avg score (DB-side)
 *   - findMany with skip/take for paginated list
 *   - NPS computed from DB-side counts, not JS-side filter
 */
export const GET = withAdmin(
  'admin/nps',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const page = assertPageDepth(url.searchParams.get('page'))
    const search = url.searchParams.get('search') || ''
    const categoryFilter = url.searchParams.get('category') || 'all'
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      // 5 parallel queries — all O(1)
      const [total, promoters, passives, detractors, avgAgg] = await Promise.all([
        // Total feedback count
        withTimeout(dbRead.npsFeedback.count(), 5000).catch(ctx.degrade('npsFeedback.count', 0)),

        // Promoters (score 9-10)
        withTimeout(
          dbRead.npsFeedback.count({ where: { score: { gte: 9 } } }),
          5000
        ).catch(ctx.degrade('npsFeedback.count', 0)),

        // Passives (score 7-8)
        withTimeout(
          dbRead.npsFeedback.count({ where: { score: { gte: 7, lte: 8 } } }),
          5000
        ).catch(ctx.degrade('npsFeedback.count', 0)),

        // Detractors (score 0-6)
        withTimeout(
          dbRead.npsFeedback.count({ where: { score: { lte: 6 } } }),
          5000
        ).catch(ctx.degrade('npsFeedback.count', 0)),

        // Average score
        withTimeout(
          dbRead.npsFeedback.aggregate({ _avg: { score: true } }),
          5000
        ).catch(ctx.degrade('npsFeedback.aggregate', ({ _avg: { score: 0 } }))),
      ])

      // NPS = % promoters - % detractors (range: -100 to +100)
      const npsScore = total > 0
        ? Math.round(((promoters - detractors) / total) * 100)
        : 0

      // Recent feedback count (last 7 days — growth signal)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const newFeedback7d = await withTimeout(
        dbRead.npsFeedback.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        5000
      ).catch(ctx.degrade('npsFeedback.count', 0))

      // Score distribution (how many 0s, 1s, 2s... 10s)
      const scoreDistribution = await withTimeout(
        dbRead.npsFeedback.groupBy({
          by: ['score'],
          _count: true,
          orderBy: { score: 'asc' },
        }),
        5000
      ).catch(ctx.degrade('npsFeedback.groupBy', []))

      return NextResponse.json({
        success: true,
        summary: {
          total,
          promoters,
          passives,
          detractors,
          npsScore,
          avgScore: avgAgg._avg.score ? Math.round(avgAgg._avg.score * 10) / 10 : 0,
          newFeedback7d,
        },
        scoreDistribution: (scoreDistribution as any[]).map((s: any) => ({
          score: s.score,
          count: s._count,
        })),
      })
    }

    // ============ LIST TAB (paginated + searchable + filterable) ============
    const skip = (page - 1) * pageSize

    // Build where clause
    const where: any = {}
    if (categoryFilter !== 'all') {
      if (categoryFilter === 'promoter') where.score = { gte: 9 }
      else if (categoryFilter === 'passive') where.score = { gte: 7, lte: 8 }
      else if (categoryFilter === 'detractor') where.score = { lte: 6 }
    }
    if (search) {
      where.OR = [
        { feedback: { contains: search, mode: 'insensitive' } },
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

    const [feedback, total] = await Promise.all([
      withTimeout(
        dbRead.npsFeedback.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            user: { select: { id: true, email: true, name: true, plan: true } },
          },
        }),
        5000
      ).catch(ctx.degrade('npsFeedback.findMany', [])),
      withTimeout(
        dbRead.npsFeedback.count({ where }),
        5000
      ).catch(ctx.degrade('npsFeedback.count', 0)),
    ])

    return NextResponse.json({
      success: true,
      feedback: (feedback as any[]).map((f: any) => ({
        id: f.id,
        score: f.score,
        feedback: f.feedback,
        category: f.category,
        createdAt: f.createdAt.toISOString(),
        userId: f.user?.id,
        userEmail: f.user?.email,
        userName: f.user?.name,
        userPlan: f.user?.plan,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {

    // A page-depth refusal is a CLIENT error carrying a useful message.

    // Re-throw it so withAdmin returns a typed 400; otherwise this

    // handler flattens it into a generic "failed to fetch".

    if (error instanceof PageTooDeepError) throw error
    console.error('NPS fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch NPS',    }, { status: 500 })
  }
},
)
