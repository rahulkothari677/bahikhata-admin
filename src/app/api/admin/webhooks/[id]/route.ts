import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { VALID_EVENTS } from '@/lib/webhook-engine'
import { assertSafeWebhookUrl } from '@/lib/webhook-url-guard'

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

    /*
     * 🔒 2026-08-04 (Phase 7 audit). This was `new URL(url)` and nothing else —
     * a SYNTAX check — while POST /api/admin/webhooks ran a full SSRF guard.
     * So the guard was a formality:
     *
     *   1. create a webhook at https://example.com                → passes
     *   2. PATCH the url to http://169.254.169.254/latest/meta-data/ → passed
     *
     * That is the cloud instance metadata service, which hands back IAM
     * credentials, and the delivery engine stores the first 1KB of every
     * response in a field the deliveries API returns — so it was not blind
     * SSRF but a full read primitive.
     *
     * Same guard as the create path now, because validation that lives on one
     * code path is not validation.
     */
    if (url !== undefined) {
      const verdict = await assertSafeWebhookUrl(url)
      if (!verdict.ok) {
        return NextResponse.json({ error: verdict.error, detail: verdict.detail }, { status: 400 })
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
