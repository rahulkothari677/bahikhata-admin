import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { getExperimentResults } from '@/lib/ab-testing'

/**
 * GET /api/admin/experiments
 * Returns experiments + results.
 * Query: ?tab=overview|list&status=all|draft|running|completed|cancelled&page=1
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const status = url.searchParams.get('status') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    if (tab === 'overview') {
      const [draftCount, runningCount, completedCount, cancelledCount, totalAssignments, runningExperiments] = await Promise.all([
        withTimeout(db.experiment.count({ where: { status: 'draft' } }), 5000).catch(() => 0),
        withTimeout(db.experiment.count({ where: { status: 'running' } }), 5000).catch(() => 0),
        withTimeout(db.experiment.count({ where: { status: 'completed' } }), 5000).catch(() => 0),
        withTimeout(db.experiment.count({ where: { status: 'cancelled' } }), 5000).catch(() => 0),
        withTimeout(db.experimentAssignment.count(), 5000).catch(() => 0),
        withTimeout(
          db.experiment.findMany({
            where: { status: 'running' },
            select: { id: true, name: true, metric: true, targetEvent: true },
          }),
          5000
        ).catch(() => []),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          draftCount,
          runningCount,
          completedCount,
          cancelledCount,
          totalAssignments,
          totalCount: draftCount + runningCount + completedCount + cancelledCount,
        },
        runningExperiments,
      })
    }

    // List tab
    const skip = (page - 1) * pageSize
    const where: any = {}
    if (status !== 'all') where.status = status

    const [experiments, total] = await Promise.all([
      withNeonRetry(() =>
        db.experiment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            _count: { select: { assignments: true } },
          },
        })
      ).catch(() => []),
      withTimeout(db.experiment.count({ where }), 5000).catch(() => 0),
    ])

    // Fetch results for running/completed experiments
    const experimentsWithResults = await Promise.all(
      (experiments as any[]).map(async (e: any) => {
        let variants: any[] = []
        try { variants = JSON.parse(e.variants) } catch {}

        let results = null
        if (e.status === 'running' || e.status === 'completed') {
          results = await getExperimentResults(e.id).catch(() => null)
        }

        return {
          id: e.id,
          name: e.name,
          description: e.description,
          status: e.status,
          metric: e.metric,
          metricGoal: e.metricGoal,
          targetEvent: e.targetEvent,
          trafficPct: e.trafficPct,
          variants,
          startAt: e.startAt?.toISOString() || null,
          endAt: e.endAt?.toISOString() || null,
          winnerVariant: e.winnerVariant,
          conclusion: e.conclusion,
          assignmentCount: e._count?.assignments || 0,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
          results,
        }
      })
    )

    return NextResponse.json({
      success: true,
      experiments: experimentsWithResults,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Experiments fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch experiments',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/experiments
 * Create a new experiment.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, description, metric, metricGoal, targetEvent, trafficPct, variants, startAt, endAt } = body

    if (!name || !metric || !Array.isArray(variants) || variants.length < 2) {
      return NextResponse.json({
        error: 'name, metric, and at least 2 variants are required',
      }, { status: 400 })
    }

    // Validate variants
    const hasControl = variants.some((v: any) => v.key === 'control')
    if (!hasControl) {
      return NextResponse.json({ error: 'Variants must include a "control" variant' }, { status: 400 })
    }

    const totalWeight = variants.reduce((sum: number, v: any) => sum + (v.weight || 0), 0)
    if (totalWeight !== 100) {
      return NextResponse.json({ error: `Variant weights must sum to 100 (got ${totalWeight})` }, { status: 400 })
    }

    const validMetrics = ['conversion', 'revenue', 'retention']
    if (!validMetrics.includes(metric)) {
      return NextResponse.json({ error: 'Invalid metric' }, { status: 400 })
    }

    // Determine status based on startAt
    let status = 'draft'
    let startAtDate: Date | null = null
    if (startAt) {
      startAtDate = new Date(startAt)
      status = startAtDate <= new Date() ? 'running' : 'draft'
    }

    const experiment = await db.experiment.create({
      data: {
        name: name.trim(),
        description: description || null,
        status,
        metric,
        metricGoal: metricGoal || 'increase',
        targetEvent: targetEvent || null,
        trafficPct: trafficPct || 100,
        variants: JSON.stringify(variants),
        startAt: startAtDate,
        endAt: endAt ? new Date(endAt) : null,
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'experiment_create',
      description: `Created experiment "${name}" (${metric}, ${variants.length} variants, status: ${status})`,
      targetType: 'experiment',
      targetId: experiment.id,
    })

    return NextResponse.json({ success: true, experiment })
  } catch (error) {
    console.error('Create experiment error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create experiment',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
