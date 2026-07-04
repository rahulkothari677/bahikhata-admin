import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

/**
 * GET /api/admin/ai-usage
 *
 * Returns aggregated AI usage stats using BULK aggregate + groupBy queries.
 * Scales to millions of AI calls — NO findMany on full tables.
 *
 * Query params:
 *   - tab: 'overview' | 'providers' | 'top-users' | 'recent'
 *     (overview = default, returns KPIs + breakdowns)
 *   - page: number (for top-users and recent tabs)
 *   - search: string (for top-users and recent tabs — search by user email)
 *   - feature: 'scan-bill' | 'voice-parse' | 'all' (filter for recent tab)
 *   - provider: 'gemini' | 'groq' | 'openai' | 'vlm' | 'all'
 *
 * Returns 4 KPIs (today/week/month/all-time) + breakdowns + paginated lists.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const search = url.searchParams.get('search') || ''
    const featureFilter = url.searchParams.get('feature') || 'all'
    const providerFilter = url.searchParams.get('provider') || 'all'
    const pageSize = 20

    const now = new Date()
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    // ============ OVERVIEW TAB (default) ============
    // Returns: 4 period KPIs + feature breakdown + provider breakdown
    if (tab === 'overview') {
      // 4 parallel aggregate queries (NOT findMany) — O(1) regardless of row count
      const [todayAgg, weekAgg, monthAgg, allTimeAgg] = await Promise.all([
        withTimeout(
          db.aiUsageLog.aggregate({
            where: { createdAt: { gte: todayStart } },
            _sum: { inputTokens: true, outputTokens: true, totalTokens: true, costInr: true },
            _count: true,
            _avg: { durationMs: true },
          }),
          5000
        ).catch(() => ({
          _sum: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costInr: 0 },
          _count: 0,
          _avg: { durationMs: 0 },
        })) as any,
        withTimeout(
          db.aiUsageLog.aggregate({
            where: { createdAt: { gte: weekStart } },
            _sum: { totalTokens: true, costInr: true },
            _count: true,
          }),
          5000
        ).catch(() => ({ _sum: { totalTokens: 0, costInr: 0 }, _count: 0 })) as any,
        withTimeout(
          db.aiUsageLog.aggregate({
            where: { createdAt: { gte: monthStart } },
            _sum: { totalTokens: true, costInr: true },
            _count: true,
          }),
          5000
        ).catch(() => ({ _sum: { totalTokens: 0, costInr: 0 }, _count: 0 })) as any,
        withTimeout(
          db.aiUsageLog.aggregate({
            _sum: { inputTokens: true, outputTokens: true, totalTokens: true, costInr: true },
            _count: true,
          }),
          5000
        ).catch(() => ({
          _sum: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costInr: 0 },
          _count: 0,
        })) as any,
      ])

      // 2 parallel groupBy queries for breakdowns (NOT JS-side filtering)
      const [featureGroup, providerGroup] = await Promise.all([
        withTimeout(
          db.aiUsageLog.groupBy({
            by: ['feature'],
            where: { createdAt: { gte: monthStart } },
            _sum: { costInr: true, totalTokens: true },
            _count: true,
          }),
          5000
        ).catch(() => []),
        withTimeout(
          db.aiUsageLog.groupBy({
            by: ['provider'],
            where: { createdAt: { gte: monthStart } },
            _sum: { costInr: true, totalTokens: true },
            _count: true,
          }),
          5000
        ).catch(() => []),
      ])

      // Success/fail counts (2 parallel count queries)
      const [todaySuccess, todayFail, monthSuccess, monthFail] = await Promise.all([
        withTimeout(
          db.aiUsageLog.count({
            where: { createdAt: { gte: todayStart }, success: true },
          }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.aiUsageLog.count({
            where: { createdAt: { gte: todayStart }, success: false },
          }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.aiUsageLog.count({
            where: { createdAt: { gte: monthStart }, success: true },
          }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.aiUsageLog.count({
            where: { createdAt: { gte: monthStart }, success: false },
          }),
          5000
        ).catch(() => 0),
      ])

      // Build feature breakdown object
      const featureBreakdown: Record<string, any> = {}
      for (const f of featureGroup as any[]) {
        featureBreakdown[f.feature] = {
          costInr: f._sum.costInr || 0,
          totalTokens: f._sum.totalTokens || 0,
          calls: f._count,
        }
      }
      // Ensure both features exist (even if 0)
      if (!featureBreakdown['scan-bill']) {
        featureBreakdown['scan-bill'] = { costInr: 0, totalTokens: 0, calls: 0 }
      }
      if (!featureBreakdown['voice-parse']) {
        featureBreakdown['voice-parse'] = { costInr: 0, totalTokens: 0, calls: 0 }
      }

      // Build provider breakdown object
      const providerBreakdown: Record<string, any> = {}
      for (const p of providerGroup as any[]) {
        providerBreakdown[p.provider] = {
          costInr: p._sum.costInr || 0,
          totalTokens: p._sum.totalTokens || 0,
          calls: p._count,
        }
      }

      return NextResponse.json({
        success: true,
        periods: {
          today: {
            calls: todayAgg._count,
            successCount: todaySuccess,
            failCount: todayFail,
            inputTokens: todayAgg._sum.inputTokens || 0,
            outputTokens: todayAgg._sum.outputTokens || 0,
            totalTokens: todayAgg._sum.totalTokens || 0,
            costInr: todayAgg._sum.costInr || 0,
            avgDurationMs: Math.round(todayAgg._avg?.durationMs || 0),
          },
          week: {
            calls: weekAgg._count,
            totalTokens: weekAgg._sum.totalTokens || 0,
            costInr: weekAgg._sum.costInr || 0,
          },
          month: {
            calls: monthAgg._count,
            successCount: monthSuccess,
            failCount: monthFail,
            totalTokens: monthAgg._sum.totalTokens || 0,
            costInr: monthAgg._sum.costInr || 0,
          },
          allTime: {
            calls: allTimeAgg._count,
            inputTokens: allTimeAgg._sum.inputTokens || 0,
            outputTokens: allTimeAgg._sum.outputTokens || 0,
            totalTokens: allTimeAgg._sum.totalTokens || 0,
            costInr: allTimeAgg._sum.costInr || 0,
          },
        },
        featureBreakdown,
        providerBreakdown,
      })
    }

    // ============ TOP USERS TAB (paginated) ============
    if (tab === 'top-users') {
      const skip = (page - 1) * pageSize

      // Build where clause for search
      const where: any = { createdAt: { gte: monthStart } }
      if (search) {
        where.user = {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      }

      // Parallel: groupBy for top users + count of distinct users
      const [topUsersAgg, distinctUserCount] = await Promise.all([
        withTimeout(
          db.aiUsageLog.groupBy({
            by: ['userId'],
            where,
            _sum: { costInr: true, totalTokens: true },
            _count: true,
            orderBy: { _sum: { costInr: 'desc' } },
            skip,
            take: pageSize,
          }),
          5000
        ).catch(() => []),
        withTimeout(
          db.aiUsageLog.groupBy({
            by: ['userId'],
            where,
            _count: true,
          }),
          5000
        ).catch(() => []),
      ])

      const total = (distinctUserCount as any[]).length
      const userIds = (topUsersAgg as any[]).map((u: any) => u.userId)

      // Fetch user details (only for current page — not all users)
      const userDetails = userIds.length > 0
        ? await withTimeout(
            db.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, email: true, name: true, plan: true },
            }),
            5000
          ).catch(() => []) as any[]
        : []

      const userMap = new Map((userDetails as any[]).map((u: any) => [u.id, u]))

      const topUsers = (topUsersAgg as any[]).map((u: any) => ({
        userId: u.userId,
        user: userMap.get(u.userId) || { id: u.userId, email: 'unknown', name: null, plan: 'free' },
        calls: u._count,
        costInr: u._sum.costInr || 0,
        totalTokens: u._sum.totalTokens || 0,
      }))

      return NextResponse.json({
        success: true,
        topUsers,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      })
    }

    // ============ RECENT CALLS TAB (paginated + filterable) ============
    if (tab === 'recent') {
      const skip = (page - 1) * pageSize

      // Build where clause
      const where: any = {}
      if (featureFilter !== 'all') where.feature = featureFilter
      if (providerFilter !== 'all') where.provider = providerFilter
      if (search) {
        where.user = {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      }

      // Parallel: paginated rows + total count
      const [recentCalls, total] = await Promise.all([
        withTimeout(
          db.aiUsageLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
            include: {
              user: { select: { email: true, name: true } },
            },
          }),
          5000
        ).catch(() => []),
        withTimeout(
          db.aiUsageLog.count({ where }),
          5000
        ).catch(() => 0),
      ])

      return NextResponse.json({
        success: true,
        recentCalls: (recentCalls as any[]).map((l: any) => ({
          id: l.id,
          feature: l.feature,
          provider: l.provider,
          model: l.model,
          inputTokens: l.inputTokens,
          outputTokens: l.outputTokens,
          totalTokens: l.totalTokens,
          costInr: l.costInr,
          success: l.success,
          errorMessage: l.errorMessage,
          durationMs: l.durationMs,
          createdAt: l.createdAt.toISOString(),
          userEmail: l.user?.email,
          userName: l.user?.name,
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      })
    }

    return NextResponse.json({ error: 'Invalid tab' }, { status: 400 })
  } catch (error) {
    console.error('Admin AI usage fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch AI usage',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
