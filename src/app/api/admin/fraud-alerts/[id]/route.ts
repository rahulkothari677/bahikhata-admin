import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/fraud-alerts/[id]
 *
 * Update alert status (acknowledge / resolve / mark false positive) + admin note.
 *
 * Body:
 *   - status: 'open' | 'acknowledged' | 'resolved' | 'false_positive'
 *   - adminNote: string (optional)
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

    const existing = await db.fraudAlert.findUnique({
      where: { id },
      include: { rule: { select: { name: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    }

    const adminId = (session.user as any).id
    const now = new Date()

    const updateData: any = {
      ...(status !== undefined && { status }),
      ...(adminNote !== undefined && { adminNote }),
    }

    if (status === 'acknowledged' && !existing.acknowledgedAt) {
      updateData.acknowledgedBy = adminId
      updateData.acknowledgedAt = now
    }
    if ((status === 'resolved' || status === 'false_positive') && !existing.resolvedAt) {
      updateData.resolvedBy = adminId
      updateData.resolvedAt = now
    }

    const updated = await db.fraudAlert.update({ where: { id }, data: updateData })

    await logAdminAction({
      adminId,
      action: 'fraud_alert_status_change',
      description: `Fraud alert for rule "${existing.rule?.name}" (user: ${existing.userName || existing.userId.slice(0, 8)}) status: ${existing.status} → ${status || existing.status}`,
      targetType: 'fraud_alert',
      targetId: id,
    })

    return NextResponse.json({ success: true, alert: updated })
  } catch (error) {
    console.error('Update fraud alert error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update alert',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
