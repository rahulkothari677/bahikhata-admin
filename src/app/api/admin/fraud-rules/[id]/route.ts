import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/fraud-rules/[id]
 * Update a fraud rule (enable/disable, edit fields).
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
    const { name, description, metric, operator, threshold, windowMinutes, userAgeMinutes, enabled, severity } = body

    const existing = await db.fraudRule.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const updated = await db.fraudRule.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(metric !== undefined && { metric }),
        ...(operator !== undefined && { operator }),
        ...(threshold !== undefined && { threshold: parseFloat(threshold) }),
        ...(windowMinutes !== undefined && { windowMinutes: windowMinutes ? parseInt(windowMinutes, 10) : null }),
        ...(userAgeMinutes !== undefined && { userAgeMinutes: userAgeMinutes ? parseInt(userAgeMinutes, 10) : null }),
        ...(enabled !== undefined && { enabled }),
        ...(severity !== undefined && { severity }),
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'fraud_rule_update',
      description: `Updated fraud rule "${existing.name}"`,
      targetType: 'fraud_rule',
      targetId: id,
    })

    return NextResponse.json({ success: true, rule: updated })
  } catch (error) {
    console.error('Update fraud rule error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update rule',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/fraud-rules/[id]
 * Hard delete (cascade alerts).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.fraudRule.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    await db.fraudRule.delete({ where: { id } })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'fraud_rule_delete',
      description: `Deleted fraud rule "${existing.name}"`,
      targetType: 'fraud_rule',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Rule deleted' })
  } catch (error) {
    console.error('Delete fraud rule error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete rule',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
