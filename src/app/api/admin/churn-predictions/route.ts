import { NextRequest, NextResponse } from 'next/server'
import { assertPageDepth, PageTooDeepError } from '@/lib/pagination'
import { withAdmin } from '@/lib/with-admin'
import { dbRead } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/churn-predictions
 *
 * Returns churn prediction analytics + paginated list.
 * Query: ?tab=overview|list&riskLevel=all|low|medium|high|critical&plan=all|free|pro|elite&page=1
 */
export const GET = withAdmin(
  'admin/churn-predictions',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const riskLevel = url.searchParams.get('riskLevel') || 'all'
    const plan = url.searchParams.get('plan') || 'all'
    const page = assertPageDepth(url.searchParams.get('page'))
    const pageSize = 20

    if (tab === 'overview') {
      const [totalUsers, lowCount, mediumCount, highCount, criticalCount, computedAt] = await Promise.all([
        withTimeout(dbRead.churnPrediction.count(), 5000).catch(ctx.degrade('churnPrediction.count', 0)),
        withTimeout(dbRead.churnPrediction.count({ where: { riskLevel: 'low' } }), 5000).catch(ctx.degrade('churnPrediction.count', 0)),
        withTimeout(dbRead.churnPrediction.count({ where: { riskLevel: 'medium' } }), 5000).catch(ctx.degrade('churnPrediction.count', 0)),
        withTimeout(dbRead.churnPrediction.count({ where: { riskLevel: 'high' } }), 5000).catch(ctx.degrade('churnPrediction.count', 0)),
        withTimeout(dbRead.churnPrediction.count({ where: { riskLevel: 'critical' } }), 5000).catch(ctx.degrade('churnPrediction.count', 0)),
        withTimeout(
          dbRead.churnPrediction.findFirst({
            orderBy: { computedAt: 'desc' },
            select: { computedAt: true },
          }),
          5000
        ).catch(ctx.degrade('churnPrediction.findFirst', null)),
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
        dbRead.churnPrediction.findMany({
          where,
          orderBy: { riskScore: 'desc' },
          skip,
          take: pageSize,
        })
      ).catch(ctx.degrade('churnPrediction.findMany', [])),
      withTimeout(dbRead.churnPrediction.count({ where }), 5000).catch(ctx.degrade('churnPrediction.count', 0)),
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

    // A page-depth refusal is a CLIENT error carrying a useful message.

    // Re-throw it so withAdmin returns a typed 400; otherwise this

    // handler flattens it into a generic "failed to fetch".

    if (error instanceof PageTooDeepError) throw error
    console.error('Churn predictions fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch predictions' }, { status: 500 })
  }
},
)
