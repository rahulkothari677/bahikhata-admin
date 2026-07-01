import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { formatINR, formatNumber } from '@/lib/utils'

/**
 * GET /api/admin/ai-usage
 *
 * Returns aggregated AI usage stats across ALL users:
 *   - Today, this week, this month, all-time
 *   - Per-feature breakdown (scan-bill vs voice-parse)
 *   - Per-provider breakdown (Gemini vs Groq vs OpenAI)
 *   - Recent calls (last 50)
 *   - Top users by AI cost (who's costing us the most)
 *   - Current pricing for display
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const now = new Date()
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    const [todayLogs, weekLogs, monthLogs, allTimeAgg, recentLogs, topUsers] = await Promise.all([
      db.aiUsageLog.findMany({ where: { createdAt: { gte: todayStart } } }),
      db.aiUsageLog.findMany({ where: { createdAt: { gte: weekStart } } }),
      db.aiUsageLog.findMany({ where: { createdAt: { gte: monthStart } } }),
      db.aiUsageLog.aggregate({
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, costInr: true },
        _count: true,
      }),
      db.aiUsageLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { email: true, name: true } },
        },
      }),
      // Top 10 users by AI cost this month
      db.aiUsageLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: monthStart } },
        _sum: { costInr: true },
        _count: true,
        orderBy: { _sum: { costInr: 'desc' } },
        take: 10,
      }),
    ])

    // Get user details for top users
    const topUserIds = topUsers.map(u => u.userId)
    const topUserDetails = await db.user.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, email: true, name: true, plan: true },
    })
    const topUsersWithData = topUsers.map(u => ({
      ...u,
      user: topUserDetails.find(d => d.id === u.userId),
    }))

    const aggregate = (logs: any[]) => ({
      calls: logs.length,
      successCount: logs.filter(l => l.success).length,
      failCount: logs.filter(l => !l.success).length,
      inputTokens: logs.reduce((s, l) => s + l.inputTokens, 0),
      outputTokens: logs.reduce((s, l) => s + l.outputTokens, 0),
      totalTokens: logs.reduce((s, l) => s + l.totalTokens, 0),
      costInr: logs.reduce((s, l) => s + l.costInr, 0),
      avgDurationMs: logs.length ? Math.round(logs.reduce((s, l) => s + l.durationMs, 0) / logs.length) : 0,
    })

    return NextResponse.json({
      success: true,
      periods: {
        today: aggregate(todayLogs),
        week: aggregate(weekLogs),
        month: aggregate(monthLogs),
        allTime: {
          calls: allTimeAgg._count,
          inputTokens: allTimeAgg._sum.inputTokens || 0,
          outputTokens: allTimeAgg._sum.outputTokens || 0,
          totalTokens: allTimeAgg._sum.totalTokens || 0,
          costInr: allTimeAgg._sum.costInr || 0,
        },
      },
      featureBreakdown: {
        'scan-bill': aggregate(monthLogs.filter(l => l.feature === 'scan-bill')),
        'voice-parse': aggregate(monthLogs.filter(l => l.feature === 'voice-parse')),
      },
      providerBreakdown: {
        gemini: aggregate(monthLogs.filter(l => l.provider === 'gemini')),
        groq: aggregate(monthLogs.filter(l => l.provider === 'groq')),
        openai: aggregate(monthLogs.filter(l => l.provider === 'openai')),
        vlm: aggregate(monthLogs.filter(l => l.provider === 'vlm')),
      },
      topUsers: topUsersWithData.map(u => ({
        userId: u.userId,
        user: u.user,
        calls: u._count,
        costInr: u._sum.costInr || 0,
      })),
      recentCalls: recentLogs.map(l => ({
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
    })
  } catch (error) {
    console.error('Admin AI usage fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI usage' }, { status: 500 })
  }
}
