import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

export const PATCH = withAdmin(
  'admin/nps-config/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const existing = await db.npsSurveyConfig.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

    const updated = await db.npsSurveyConfig.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.triggerType !== undefined && { triggerType: body.triggerType }),
        ...(body.triggerValue !== undefined && { triggerValue: body.triggerValue }),
        ...(body.question !== undefined && { question: body.question }),
        ...(body.cooldownDays !== undefined && { cooldownDays: body.cooldownDays }),
        ...(body.targetPlans !== undefined && { targetPlans: body.targetPlans }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.priority !== undefined && { priority: body.priority }),
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'nps_config_update',
      description: `Updated NPS config "${existing.name}"`,
      targetType: 'nps_config',
      targetId: id,
    })

    return NextResponse.json({ success: true, config: updated })
  } catch (error) {
    console.error('[admin/nps-config/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
},
)

export const DELETE = withAdmin(
  'admin/nps-config/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.npsSurveyConfig.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

    await db.npsSurveyConfig.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'nps_config_delete',
      description: `Deleted NPS config "${existing.name}"`,
      targetType: 'nps_config',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Config deleted' })
  } catch (error) {
    console.error('[admin/nps-config/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
},
)
