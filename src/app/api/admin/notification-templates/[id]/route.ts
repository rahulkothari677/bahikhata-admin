import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/notification-templates/[id]
 * Returns a single notification template by ID.
 */
export const GET = withAdmin(
  'admin/notification-templates/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const template = await withTimeout(
      db.notificationTemplate.findUnique({ where: { id } }),
      5000
    ).catch(ctx.degrade('notificationTemplate.findUnique', null))

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error('[admin/notification-templates/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 })
  }
},
)

/**
 * PATCH /api/admin/notification-templates/[id]
 * Update a notification template. Bumps version on each edit.
 */
export const PATCH = withAdmin(
  'admin/notification-templates/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, category, channel, subject, body: templateBody, variables, language, status } = body

    // Check template exists
    const existing = await db.notificationTemplate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Validate channel change
    if (channel && !['sms', 'email', 'push'].includes(channel)) {
      return NextResponse.json({ error: 'Invalid channel' }, { status: 400 })
    }

    // Auto-detect variables from new body if body changed
    let finalVars = existing.variables
    if (templateBody) {
      const detectedVars = Array.from(templateBody.matchAll(/\{\{(\w+)\}\}/g) as IterableIterator<RegExpMatchArray>).map(m => m[1])
      const uniqueDetectedVars = Array.from(new Set(detectedVars))
      const providedVars = Array.isArray(variables) ? variables : []
      const allVars = Array.from(new Set([...providedVars, ...uniqueDetectedVars]))
      finalVars = JSON.stringify(allVars)
    }

    const updated = await db.notificationTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(channel !== undefined && { channel }),
        ...(subject !== undefined && { subject }),
        ...(templateBody !== undefined && { body: templateBody }),
        ...(finalVars !== existing.variables && { variables: finalVars }),
        ...(language !== undefined && { language }),
        ...(status !== undefined && { status }),
        version: existing.version + 1,
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'notification_template_update',
      description: `Updated template "${existing.name}" (v${existing.version} → v${updated.version})`,
      targetType: 'notification_template',
      targetId: id,
    })

    return NextResponse.json({ success: true, template: updated })
  } catch (error) {
    console.error('Update template error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update template',    }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/notification-templates/[id]
 * Delete a notification template (hard delete — admin confirmation required in UI).
 */
export const DELETE = withAdmin(
  'admin/notification-templates/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.notificationTemplate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    await db.notificationTemplate.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'notification_template_delete',
      description: `Deleted template "${existing.name}" (${existing.channel})`,
      targetType: 'notification_template',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Template deleted' })
  } catch (error) {
    console.error('Delete template error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete template',    }, { status: 500 })
  }
},
)
