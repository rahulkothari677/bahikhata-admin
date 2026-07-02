import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/bulk-jobs
 * Returns scheduled bulk jobs + stats.
 * Query: ?tab=overview|list&status=all|scheduled|running|completed|failed|cancelled&page=1
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'
    const status = url.searchParams.get('status') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    if (tab === 'overview') {
      const [scheduledCount, runningCount, completedCount, failedCount, cancelledCount, totalProcessed, upcomingJobs] = await Promise.all([
        withTimeout(db.bulkJob.count({ where: { status: 'scheduled' } }), 5000).catch(() => 0),
        withTimeout(db.bulkJob.count({ where: { status: 'running' } }), 5000).catch(() => 0),
        withTimeout(db.bulkJob.count({ where: { status: 'completed' } }), 5000).catch(() => 0),
        withTimeout(db.bulkJob.count({ where: { status: 'failed' } }), 5000).catch(() => 0),
        withTimeout(db.bulkJob.count({ where: { status: 'cancelled' } }), 5000).catch(() => 0),
        withTimeout(db.bulkJob.aggregate({ _sum: { processedCount: true } }), 5000).catch(() => ({ _sum: { processedCount: 0 } })),
        withNeonRetry(() =>
          db.bulkJob.findMany({
            where: { status: 'scheduled', scheduledAt: { gte: new Date() } },
            orderBy: { scheduledAt: 'asc' },
            take: 5,
            select: { id: true, name: true, action: true, scheduledAt: true, totalTargets: true },
          })
        ).catch(() => []),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          scheduledCount,
          runningCount,
          completedCount,
          failedCount,
          cancelledCount,
          totalProcessed: totalProcessed._sum.processedCount || 0,
          totalCount: scheduledCount + runningCount + completedCount + failedCount + cancelledCount,
        },
        upcomingJobs,
      })
    }

    // List tab
    const skip = (page - 1) * pageSize
    const where: any = {}
    if (status !== 'all') where.status = status

    const [jobs, total] = await Promise.all([
      withNeonRetry(() =>
        db.bulkJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        })
      ).catch(() => []),
      withTimeout(db.bulkJob.count({ where }), 5000).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      jobs: (jobs as any[]).map((j: any) => ({
        id: j.id,
        name: j.name,
        action: j.action,
        targetType: j.targetType,
        targetCriteria: (() => { try { return JSON.parse(j.targetCriteria) } catch { return {} } })(),
        actionParams: (() => { try { return JSON.parse(j.actionParams) } catch { return {} } })(),
        status: j.status,
        scheduledAt: j.scheduledAt.toISOString(),
        startedAt: j.startedAt?.toISOString() || null,
        completedAt: j.completedAt?.toISOString() || null,
        totalTargets: j.totalTargets,
        processedCount: j.processedCount,
        successCount: j.successCount,
        failedCount: j.failedCount,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Bulk jobs fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch bulk jobs' }, { status: 500 })
  }
}

/**
 * POST /api/admin/bulk-jobs
 * Create a new scheduled bulk job.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, action, targetType, targetCriteria, actionParams, scheduledAt } = body

    if (!name || !action || !scheduledAt) {
      return NextResponse.json({ error: 'name, action, and scheduledAt are required' }, { status: 400 })
    }

    const validActions = ['change_plan', 'message', 'ban', 'delete', 'export']
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const job = await db.bulkJob.create({
      data: {
        name: name.trim(),
        action,
        targetType: targetType || 'user',
        targetCriteria: JSON.stringify(targetCriteria || {}),
        actionParams: JSON.stringify(actionParams || {}),
        status: 'scheduled',
        scheduledAt: new Date(scheduledAt),
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'bulk_job_create',
      description: `Created bulk job "${name}" (${action}, scheduled for ${new Date(scheduledAt).toLocaleString()})`,
      targetType: 'bulk_job',
      targetId: job.id,
    })

    return NextResponse.json({ success: true, job })
  } catch (error) {
    console.error('Create bulk job error:', error)
    return NextResponse.json({ error: 'Failed to create bulk job' }, { status: 500 })
  }
}
