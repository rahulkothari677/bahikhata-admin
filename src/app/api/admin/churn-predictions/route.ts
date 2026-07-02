import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/churn-predictions
 *
 * Returns churn prediction analytics + paginated list.
 * Query: ?tab=overview|list&riskLevel=all|low|medium|high|critical&plan=all|free|pro|elite&page=1
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const riskLevel = url.searchParams.get('riskLevel') || 'all'
    const plan = url.searchParams.get('plan') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    if (tab === 'overview') {
      const [totalUsers, lowCount, mediumCount, highCount, criticalCount, computedAt] = await Promise.all([
        withTimeout(db.churnPrediction.count(), 5000).catch(() => 0),
        withTimeout(db.churnPrediction.count({ where: { riskLevel: 'low' } }), 5000).catch(() => 0),
        withTimeout(db.churnPrediction.count({ where: { riskLevel: 'medium' } }), 5000).catch(() => 0),
        withTimeout(db.churnPrediction.count({ where: { riskLevel: 'high' } }), 5000).catch(() => 0),
        withTimeout(db.churnPrediction.count({ where: { riskLevel: 'critical' } }), 5000).catch(() => 0),
        withTimeout(
          db.churnPrediction.findFirst({
            orderBy: { computedAt: 'desc' },
            select: { computedAt: true },
          }),
          5000
        ).catch(() => null),
      ])

      const atRiskCount = highCount + criticalCount
      const atRiskPct = totalUsers > 0 ? Math.round((atRiskCount / totalUsers) * 1000) / 10 : 0

      return NextResponse.json({
        success: true,
        overview: {
          totalUsers,
          lowCount,
          mediumCount,
          highCount,
          criticalCount,
          atRiskCount,
          atRiskPct,
          lastComputedAt: computedAt?.computedAt?.toISOString() || null,
        },
      })
    }

    // List tab
    const skip = (page - 1) * pageSize
    const where: any = {}
    if (riskLevel !== 'all') where.riskLevel = riskLevel
    if (plan !== 'all') where.userPlan = plan

    const [predictions, total] = await Promise.all([
      withNeonRetry(() =>
        db.churnPrediction.findMany({
          where,
          orderBy: { riskScore: 'desc' },
          skip,
          take: pageSize,
        })
      ).catch(() => []),
      withTimeout(db.churnPrediction.count({ where }), 5000).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      predictions: (predictions as any[]).map((p: any) => ({
        ...p,
        computedAt: p.computedAt.toISOString(),
      })),
      page, pageSize, total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Churn predictions fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch predictions' }, { status: 500 })
  }
}
