import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeHealthScore } from '@/lib/health-score'
import { db } from '@/lib/db'

/**
 * GET /api/admin/health?userId=xxx  → single user health score
 * GET /api/admin/health              → all users health scores (summary)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const userId = url.searchParams.get('userId')

    // Single user detail
    if (userId) {
      const score = await computeHealthScore(userId)
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true, plan: true },
      })
      return NextResponse.json({ success: true, score, user })
    }

    // All users summary
    const users = await db.user.findMany({
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
    })

    // Compute health scores for all users
    const scores = await Promise.all(users.map(async u => {
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

    // Sort by score descending (healthiest first)
    scores.sort((a, b) => b.score - a.score)

    // Summary stats
    const summary = {
      total: scores.length,
      excellent: scores.filter(s => s.band === 'excellent').length,
      good: scores.filter(s => s.band === 'good').length,
      atRisk: scores.filter(s => s.band === 'at_risk').length,
      critical: scores.filter(s => s.band === 'critical').length,
      avgScore: scores.length > 0 ? Math.round(scores.reduce((s, u) => s + u.score, 0) / scores.length) : 0,
    }

    return NextResponse.json({ success: true, scores, summary })
  } catch (error) {
    console.error('Health score error:', error)
    return NextResponse.json({ error: 'Failed to compute health scores' }, { status: 500 })
  }
}
