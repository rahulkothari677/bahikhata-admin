import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/bulk-jobs/[id]
 * Update job (cancel, change schedule).
 */
export const PATCH = withAdmin(
  'admin/bulk-jobs/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { status, scheduledAt } = body

    const existing = await db.bulkJob.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Can only cancel scheduled jobs
    if (status === 'cancelled' && existing.status !== 'scheduled') {
      return NextResponse.json({ error: 'Can only cancel scheduled jobs' }, { status: 400 })
    }

    const updated = await db.bulkJob.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'bulk_job_update',
      description: `Updated bulk job "${existing.name}" — status: ${status || existing.status}`,
      targetType: 'bulk_job',
      targetId: id,
    })

    return NextResponse.json({ success: true, job: updated })
  } catch (error) {
    console.error('[admin/bulk-jobs/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/bulk-jobs/[id]
 * Hard delete (only if scheduled or cancelled).
 */
export const DELETE = withAdmin(
  'admin/bulk-jobs/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.bulkJob.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!['scheduled', 'cancelled', 'failed'].includes(existing.status)) {
      return NextResponse.json({ error: 'Can only delete scheduled, cancelled, or failed jobs' }, { status: 400 })
    }

    await db.bulkJob.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'bulk_job_delete',
      description: `Deleted bulk job "${existing.name}"`,
      targetType: 'bulk_job',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Job deleted' })
  } catch (error) {
    console.error('[admin/bulk-jobs/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 })
  }
},
)
