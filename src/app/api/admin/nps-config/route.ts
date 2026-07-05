import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

const VALID_TRIGGERS = ['days_after_signup', 'transaction_count', 'days_since_last_survey', 'plan_upgrade', 'manual']

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'

    if (tab === 'overview') {
      const [enabledCount, disabledCount, totalShown, totalResponded] = await Promise.all([
        withTimeout(db.npsSurveyConfig.count({ where: { enabled: true } }), 5000).catch(() => 0),
        withTimeout(db.npsSurveyConfig.count({ where: { enabled: false } }), 5000).catch(() => 0),
        withTimeout(db.npsSurveyConfig.aggregate({ _sum: { timesShown: true } }), 5000).catch(() => ({ _sum: { timesShown: 0 } })),
        withTimeout(db.npsSurveyConfig.aggregate({ _sum: { timesResponded: true } }), 5000).catch(() => ({ _sum: { timesResponded: 0 } })),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          enabledCount,
          disabledCount,
          totalCount: enabledCount + disabledCount,
          totalShown: totalShown._sum.timesShown || 0,
          totalResponded: totalResponded._sum.timesResponded || 0,
          responseRate: (totalShown._sum.timesShown || 0) > 0
            ? Math.round(((totalResponded._sum.timesResponded || 0) / (totalShown._sum.timesShown || 1)) * 1000) / 10
            : 0,
        },
      })
    }

    const configs = await withNeonRetry(() =>
      db.npsSurveyConfig.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 500 })  // 🔒 V6 SC2: defensive cap
    ).catch(() => [])

    return NextResponse.json({
      success: true,
      configs: (configs as any[]).map((c: any) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch NPS config' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, triggerType, triggerValue, question, cooldownDays, targetPlans, enabled, priority } = body

    if (!name || !triggerType) {
      return NextResponse.json({ error: 'name and triggerType are required' }, { status: 400 })
    }
    if (!VALID_TRIGGERS.includes(triggerType)) {
      return NextResponse.json({ error: 'Invalid triggerType' }, { status: 400 })
    }

    const config = await db.npsSurveyConfig.create({
      data: {
        name: name.trim(),
        triggerType,
        triggerValue: triggerValue || 7,
        question: question || 'How likely are you to recommend BahiKhata Pro to a friend or colleague?',
        cooldownDays: cooldownDays || 90,
        targetPlans: targetPlans || 'all',
        enabled: enabled !== false,
        priority: priority || 1,
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'nps_config_create',
      description: `Created NPS survey config "${name}" (trigger: ${triggerType})`,
      targetType: 'nps_config',
      targetId: config.id,
    })

    return NextResponse.json({ success: true, config })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create config' }, { status: 500 })
  }
}
