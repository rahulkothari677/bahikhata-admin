import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { VALID_EVENTS } from '@/lib/webhook-engine'

/**
 * PATCH /api/admin/webhooks/[id]
 * Update webhook endpoint (url, events, status, description).
 */
export const PATCH = withAdmin(
  'admin/webhooks/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { url, events, status, description } = body

    const existing = await db.webhookEndpoint.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 })
    }

    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0) {
        return NextResponse.json({ error: 'Events must be a non-empty array' }, { status: 400 })
      }
      const invalid = events.filter((e: string) => !VALID_EVENTS.includes(e))
      if (invalid.length > 0) {
        return NextResponse.json({ error: `Invalid events: ${invalid.join(', ')}` }, { status: 400 })
      }
    }

    if (url !== undefined) {
      try { new URL(url) } catch {
        return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
      }
    }

    const updated = await db.webhookEndpoint.update({
      where: { id },
      data: {
        ...(url !== undefined && { url }),
        ...(events !== undefined && { events: JSON.stringify(events) }),
        ...(status !== undefined && { status }),
        ...(description !== undefined && { description }),
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'webhook_update',
      description: `Updated webhook endpoint (URL: ${existing.url})`,
      targetType: 'webhook_endpoint',
      targetId: id,
    })

    return NextResponse.json({ success: true, endpoint: updated })
  } catch (error) {
    console.error('Update webhook error:', error)
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/webhooks/[id]
 * Hard delete (cascade deliveries).
 */
export const DELETE = withAdmin(
  'admin/webhooks/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.webhookEndpoint.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 })
    }

    await db.webhookEndpoint.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'webhook_delete',
      description: `Deleted webhook endpoint (URL: ${existing.url})`,
      targetType: 'webhook_endpoint',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Webhook deleted' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 })
  }
},
)
