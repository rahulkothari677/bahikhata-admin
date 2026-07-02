import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/bulk-jobs/[id]
 * Update job (cancel, change schedule).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      adminId: (session.user as any).id,
      action: 'bulk_job_update',
      description: `Updated bulk job "${existing.name}" — status: ${status || existing.status}`,
      targetType: 'bulk_job',
      targetId: id,
    })

    return NextResponse.json({ success: true, job: updated })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/bulk-jobs/[id]
 * Hard delete (only if scheduled or cancelled).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      adminId: (session.user as any).id,
      action: 'bulk_job_delete',
      description: `Deleted bulk job "${existing.name}"`,
      targetType: 'bulk_job',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Job deleted' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 })
  }
}
