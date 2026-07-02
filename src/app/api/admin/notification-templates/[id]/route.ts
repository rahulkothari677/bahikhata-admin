import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/notification-templates/[id]
 * Returns a single notification template by ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const template = await withTimeout(
      db.notificationTemplate.findUnique({ where: { id } }),
      5000
    ).catch(() => null)

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, template })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/notification-templates/[id]
 * Update a notification template. Bumps version on each edit.
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
      adminId: (session.user as any).id,
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
      error: 'Failed to update template',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/notification-templates/[id]
 * Delete a notification template (hard delete — admin confirmation required in UI).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.notificationTemplate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    await db.notificationTemplate.delete({ where: { id } })

    await logAdminAction({
      adminId: (session.user as any).id,
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
      error: 'Failed to delete template',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
