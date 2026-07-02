import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/nps
 * Returns all NPS feedback with summary stats.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [feedback, stats] = await Promise.all([
      db.npsFeedback.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { user: { select: { email: true, name: true, plan: true } } },
      }),
      db.npsFeedback.aggregate({
        _avg: { score: true },
        _count: true,
      }),
    ])

    const promoters = feedback.filter(f => f.score >= 9).length
    const passives = feedback.filter(f => f.score >= 7 && f.score <= 8).length
    const detractors = feedback.filter(f => f.score <= 6).length
    const npsScore = feedback.length > 0
      ? Math.round(((promoters - detractors) / feedback.length) * 100)
      : 0

    return NextResponse.json({
      success: true,
      feedback: feedback.map(f => ({
        id: f.id,
        score: f.score,
        feedback: f.feedback,
        category: f.category,
        createdAt: f.createdAt.toISOString(),
        userEmail: f.user?.email,
        userName: f.user?.name,
        userPlan: f.user?.plan,
      })),
      summary: {
        total: stats._count,
        avgScore: stats._avg.score ? Math.round(stats._avg.score * 10) / 10 : 0,
        npsScore,
        promoters,
        passives,
        detractors,
      },
    })
  } catch (error) {
    console.error('NPS fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch NPS' }, { status: 500 })
  }
}
