import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
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
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const status = url.searchParams.get('status') || 'all'
    const severity = url.searchParams.get('severity') || 'all'
    const metric = url.searchParams.get('metric') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const [openCount, acknowledgedCount, resolvedCount, criticalOpenCount, recent24h, metricDist] = await Promise.all([
        withTimeout(db.anomaly.count({ where: { status: 'open' } }), 5000).catch(() => 0),
        withTimeout(db.anomaly.count({ where: { status: 'acknowledged' } }), 5000).catch(() => 0),
        withTimeout(db.anomaly.count({ where: { status: 'resolved' } }), 5000).catch(() => 0),
        withTimeout(
          db.anomaly.count({ where: { status: 'open', severity: 'critical' } }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.anomaly.count({
            where: { detectedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.anomaly.groupBy({
            by: ['metric'],
            where: { status: 'open' },
            _count: true,
          }),
          5000
        ).catch(() => []),
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
        db.anomaly.findMany({
          where,
          orderBy: { detectedAt: 'desc' },
          skip,
          take: pageSize,
        }),
        5000
      ).catch(() => []),
      withTimeout(db.anomaly.count({ where }), 5000).catch(() => 0),
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
    console.error('Anomalies fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch anomalies',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
