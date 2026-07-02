import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

/**
 * GET /api/admin/fraud-alerts
 * Returns fraud alerts (paginated + filterable).
 *
 * Query:
 *   - status: 'all' | 'open' | 'acknowledged' | 'resolved' | 'false_positive'
 *   - severity: 'all' | 'low' | 'medium' | 'high' | 'critical'
 *   - ruleId: specific rule ID (optional)
 *   - page: number (default 1)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const status = url.searchParams.get('status') || 'all'
    const severity = url.searchParams.get('severity') || 'all'
    const ruleId = url.searchParams.get('ruleId')
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    const skip = (page - 1) * pageSize

    const where: any = {}
    if (status !== 'all') where.status = status
    if (ruleId) where.ruleId = ruleId
    if (severity !== 'all') where.rule = { severity }

    const [alerts, total] = await Promise.all([
      withTimeout(
        db.fraudAlert.findMany({
          where,
          orderBy: { detectedAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            rule: {
              select: { name: true, metric: true, severity: true, description: true },
            },
          },
        }),
        5000
      ).catch(() => []),
      withTimeout(db.fraudAlert.count({ where }), 5000).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      alerts: (alerts as any[]).map((a: any) => ({
        id: a.id,
        ruleId: a.ruleId,
        ruleName: a.rule?.name || 'Unknown rule',
        ruleMetric: a.rule?.metric,
        ruleSeverity: a.rule?.severity,
        ruleDescription: a.rule?.description,
        userId: a.userId,
        userName: a.userName,
        userEmail: a.userEmail,
        metricValue: a.metricValue,
        threshold: a.threshold,
        status: a.status,
        adminNote: a.adminNote,
        detectedAt: a.detectedAt.toISOString(),
        acknowledgedBy: a.acknowledgedBy,
        acknowledgedAt: a.acknowledgedAt?.toISOString() || null,
        resolvedBy: a.resolvedBy,
        resolvedAt: a.resolvedAt?.toISOString() || null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Fraud alerts fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch alerts',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
