import { NextRequest, NextResponse } from 'next/server'
import { assertPageDepth, PageTooDeepError } from '@/lib/pagination'
import { withAdmin } from '@/lib/with-admin'
import { dbRead } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { getMetricConfigs } from '@/lib/anomaly-detection'

/**
 * GET /api/admin/anomalies
 *
 * Returns anomaly analytics + paginated list.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - status: 'all' | 'open' | 'acknowledged' | 'resolved'
 *   - severity: 'all' | 'low' | 'medium' | 'high' | 'critical'
 *   - metric: 'all' | specific metric key
 *   - page: number (default 1)
 */
export const GET = withAdmin(
  'admin/anomalies',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const status = url.searchParams.get('status') || 'all'
    const severity = url.searchParams.get('severity') || 'all'
    const metric = url.searchParams.get('metric') || 'all'
    const page = assertPageDepth(url.searchParams.get('page'))
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const [openCount, acknowledgedCount, resolvedCount, criticalOpenCount, recent24h, metricDist] = await Promise.all([
        withTimeout(dbRead.anomaly.count({ where: { status: 'open' } }), 5000).catch(ctx.degrade('anomaly.count', 0)),
        withTimeout(dbRead.anomaly.count({ where: { status: 'acknowledged' } }), 5000).catch(ctx.degrade('anomaly.count', 0)),
        withTimeout(dbRead.anomaly.count({ where: { status: 'resolved' } }), 5000).catch(ctx.degrade('anomaly.count', 0)),
        withTimeout(
          dbRead.anomaly.count({ where: { status: 'open', severity: 'critical' } }),
          5000
        ).catch(ctx.degrade('anomaly.count', 0)),
        withTimeout(
          dbRead.anomaly.count({
            where: { detectedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          }),
          5000
        ).catch(ctx.degrade('anomaly.count', 0)),
        withTimeout(
          dbRead.anomaly.groupBy({
            by: ['metric'],
            where: { status: 'open' },
            _count: true,
          }),
          5000
        ).catch(ctx.degrade('anomaly.groupBy', [])),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          openCount,
          acknowledgedCount,
          resolvedCount,
          criticalOpenCount,
          recent24h,
          totalCount: openCount + acknowledgedCount + resolvedCount,
        },
        metricDistribution: (metricDist as any[]).map((m: any) => ({
          metric: m.metric,
          count: m._count,
        })),
        trackedMetrics: getMetricConfigs(),
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    const where: any = {}
    if (status !== 'all') where.status = status
    if (severity !== 'all') where.severity = severity
    if (metric !== 'all') where.metric = metric

    const [anomalies, total] = await Promise.all([
      withTimeout(
        dbRead.anomaly.findMany({
          where,
          orderBy: { detectedAt: 'desc' },
          skip,
          take: pageSize,
        }),
        5000
      ).catch(ctx.degrade('anomaly.findMany', [])),
      withTimeout(dbRead.anomaly.count({ where }), 5000).catch(ctx.degrade('anomaly.count', 0)),
    ])

    return NextResponse.json({
      success: true,
      anomalies: (anomalies as any[]).map((a: any) => ({
        id: a.id,
        metric: a.metric,
        metricLabel: a.metricLabel,
        direction: a.direction,
        severity: a.severity,
        status: a.status,
        currentValue: a.currentValue,
        baselineValue: a.baselineValue,
        baselineStdDev: a.baselineStdDev,
        zScore: a.zScore,
        baselineDays: a.baselineDays,
        detectedAt: a.detectedAt.toISOString(),
        windowStart: a.windowStart.toISOString(),
        windowEnd: a.windowEnd.toISOString(),
        acknowledgedBy: a.acknowledgedBy,
        acknowledgedAt: a.acknowledgedAt?.toISOString() || null,
        resolvedBy: a.resolvedBy,
        resolvedAt: a.resolvedAt?.toISOString() || null,
        adminNote: a.adminNote,
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
    console.error('Anomalies fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch anomalies',    }, { status: 500 })
  }
},
)
