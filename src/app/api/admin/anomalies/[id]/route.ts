import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/anomalies/[id]
 *
 * Update anomaly status (acknowledge / resolve) + admin note.
 *
 * Body:
 *   - status: 'open' | 'acknowledged' | 'resolved'
 *   - adminNote: string (optional — explanation of resolution)
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
    const { status, adminNote } = body

    const existing = await db.anomaly.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Anomaly not found' }, { status: 404 })
    }

    const adminId = (session.user as any).id
    const now = new Date()

    const updateData: any = {
      ...(status !== undefined && { status }),
      ...(adminNote !== undefined && { adminNote }),
    }

    // Set acknowledged/resolved metadata based on status change
    if (status === 'acknowledged' && !existing.acknowledgedAt) {
      updateData.acknowledgedBy = adminId
      updateData.acknowledgedAt = now
    }
    if (status === 'resolved' && !existing.resolvedAt) {
      updateData.resolvedBy = adminId
      updateData.resolvedAt = now
    }

    const updated = await db.anomaly.update({ where: { id }, data: updateData })

    await logAdminAction({
      adminId,
      action: 'anomaly_status_change',
      description: `Anomaly "${existing.metricLabel}" (${existing.direction}) status: ${existing.status} → ${status || existing.status}`,
      targetType: 'anomaly',
      targetId: id,
    })

    return NextResponse.json({ success: true, anomaly: updated })
  } catch (error) {
    console.error('Update anomaly error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update anomaly',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
