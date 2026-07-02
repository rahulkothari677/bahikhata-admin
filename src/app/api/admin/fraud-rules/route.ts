import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { METRIC_CONFIGS, OPERATOR_CONFIGS } from '@/lib/fraud-rules-engine'

/**
 * GET /api/admin/fraud-rules
 * Returns all fraud rules with stats + alert counts.
 * Query: ?tab=overview|list
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'

    if (tab === 'overview') {
      const [enabledCount, disabledCount, openAlertCount, criticalOpenCount, rulesByMetric] = await Promise.all([
        withTimeout(db.fraudRule.count({ where: { enabled: true } }), 5000).catch(() => 0),
        withTimeout(db.fraudRule.count({ where: { enabled: false } }), 5000).catch(() => 0),
        withTimeout(db.fraudAlert.count({ where: { status: 'open' } }), 5000).catch(() => 0),
        withTimeout(
          db.fraudAlert.count({
            where: { status: 'open', rule: { severity: 'critical' } },
          }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.fraudRule.groupBy({
            by: ['metric'],
            _count: true,
          }),
          5000
        ).catch(() => []),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          enabledCount,
          disabledCount,
          openAlertCount,
          criticalOpenCount,
          totalRules: enabledCount + disabledCount,
        },
        metricDistribution: (rulesByMetric as any[]).map((m: any) => ({
          metric: m.metric,
          count: m._count,
        })),
        metricConfigs: METRIC_CONFIGS,
        operatorConfigs: OPERATOR_CONFIGS,
      })
    }

    // List tab
    const rules = await withTimeout(
      db.fraudRule.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { alerts: { where: { status: 'open' } } },
          },
        },
      }),
      5000
    ).catch(() => [])

    return NextResponse.json({
      success: true,
      rules: (rules as any[]).map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        metric: r.metric,
        operator: r.operator,
        threshold: r.threshold,
        windowMinutes: r.windowMinutes,
        userAgeMinutes: r.userAgeMinutes,
        enabled: r.enabled,
        severity: r.severity,
        openAlertCount: r._count?.alerts || 0,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Fraud rules fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch fraud rules',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/fraud-rules
 * Create a new fraud rule.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, description, metric, operator, threshold, windowMinutes, userAgeMinutes, enabled, severity } = body

    if (!name || !metric || !operator || threshold === undefined) {
      return NextResponse.json({
        error: 'Missing required fields: name, metric, operator, threshold',
      }, { status: 400 })
    }

    const validMetrics = METRIC_CONFIGS.map(m => m.key)
    if (!validMetrics.includes(metric)) {
      return NextResponse.json({ error: `Invalid metric. Valid: ${validMetrics.join(', ')}` }, { status: 400 })
    }

    const validOperators = OPERATOR_CONFIGS.map(o => o.key)
    if (!validOperators.includes(operator)) {
      return NextResponse.json({ error: `Invalid operator. Valid: ${validOperators.join(', ')}` }, { status: 400 })
    }

    // new_user_with_activity requires userAgeMinutes
    if (metric === 'new_user_with_activity' && !userAgeMinutes) {
      return NextResponse.json({
        error: 'new_user_with_activity metric requires userAgeMinutes',
      }, { status: 400 })
    }

    const rule = await db.fraudRule.create({
      data: {
        name: name.trim(),
        description: description || null,
        metric,
        operator,
        threshold: parseFloat(threshold),
        windowMinutes: windowMinutes ? parseInt(windowMinutes, 10) : null,
        userAgeMinutes: userAgeMinutes ? parseInt(userAgeMinutes, 10) : null,
        enabled: enabled !== false,
        severity: severity || 'medium',
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'fraud_rule_create',
      description: `Created fraud rule "${name}" (${metric} ${operator} ${threshold})`,
      targetType: 'fraud_rule',
      targetId: rule.id,
    })

    return NextResponse.json({ success: true, rule })
  } catch (error) {
    console.error('Create fraud rule error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create rule',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
