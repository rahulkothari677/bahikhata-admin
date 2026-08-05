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
  /*
   * 🔒 2026-08-05: `stage` records how far the handler got.
   *
   * This route returned a flat 500 in production, and the FIRST attempt to fix
   * it — deleting the deliveries explicitly — did not help. That left two
   * possibilities that the response could not tell apart: the fix was deployed
   * and something else fails, or the fix was not deployed yet and I was testing
   * the old code. A 500 that does not say where it happened cannot be debugged
   * from the outside, only guessed at, and guessing is what produced the first
   * wrong fix.
   *
   * `stage` also doubles as a deploy marker: its presence in a 500 body proves
   * which build answered.
   */
  let stage = 'start'
  try {
    const { id } = await params
    stage = 'find'
    const existing = await db.webhookEndpoint.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 })
    }

    /*
     * 🔒 2026-08-05: delete the deliveries explicitly, in one transaction.
     *
     * This route returned a flat 500 in production on a real endpoint with zero
     * deliveries. The handler itself is correct — driven with a healthy mocked
     * database it returns 200 and calls findUnique → delete → audit without
     * throwing — and the error carried NO Prisma code, which rules out both a
     * classified foreign-key violation (P2003) and a missing record (P2025).
     * An unclassified database error is what Prisma reports when the underlying
     * constraint is not one it modelled.
     *
     * The schema declares WebhookDelivery.endpoint with onDelete: Cascade, so
     * `delete` alone SHOULD suffice. But this app has no prisma/migrations
     * directory — the schema is pushed — so whether the live database actually
     * carries that cascade cannot be established from the code, and a schema
     * that was edited after the table was created would leave it behind.
     *
     * Removing the children first makes the operation correct whether the
     * cascade exists or not. It costs one extra statement, it is idempotent,
     * and it does not depend on a database detail this repo cannot verify.
     *
     * Deliberately NOT wrapped in $transaction, so that when this still fails
     * the `stage` field says which of the two statements failed — a single
     * "transaction" stage would not. The cost of that choice is small: a
     * failure between the two leaves the endpoint alive with its delivery LOG
     * cleared. Deliveries are a delivery history, not records anyone is owed,
     * and no row is orphaned in either order of failure.
     *
     * deleteMany, not delete: delete throws P2025 when it matches nothing, so a
     * double-click would turn a no-op into a 500.
     */
    stage = 'delete-deliveries'
    await db.webhookDelivery.deleteMany({ where: { endpointId: id } })
    stage = 'delete-endpoint'
    await db.webhookEndpoint.deleteMany({ where: { id } })

    stage = 'audit'
    await logAdminAction({
      adminId: ctx.adminId,
      action: 'webhook_delete',
      description: `Deleted webhook endpoint (URL: ${existing.url})`,
      targetType: 'webhook_endpoint',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Webhook deleted' })
  } catch (error) {
    /*
     * 🔒 2026-08-04 (Phase 7 audit): this catch discarded the error entirely —
     * no console.error, unlike the PATCH handler thirty lines above.
     *
     * Deleting a webhook fails in production with a flat 500, and because the
     * cause was thrown away there was no way to find out why: not from the
     * response, not from the logs. An error handler that drops its error turns
     * a fixable bug into an unfixable one.
     *
     * The Prisma error CODE is returned alongside the message. Codes like
     * P2003 (foreign key) and P2025 (record not found) are documented
     * constants, not internals — they say which class of failure occurred
     * without leaking column names, constraint names or query text, which is
     * what an earlier audit removed from the setup route.
     */
    const e = (error ?? {}) as { code?: unknown; name?: unknown; message?: unknown; meta?: unknown }
    const code = e.code !== undefined ? String(e.code) : undefined

    /*
     * 🔒 2026-08-05: the error's CLASS is reported too, not just its code.
     *
     * The production 500 carried no `code` at all, which is what Prisma does
     * for PrismaClientUnknownRequestError, PrismaClientValidationError and for
     * any error that is not Prisma's — three very different faults that the
     * previous response rendered identically. `name` separates them.
     *
     * The message is truncated at Postgres's DETAIL: marker. Everything before
     * it names the constraint or the table; everything after it can quote the
     * offending ROW, which is the part that would leak data.
     */
    const detail =
      typeof e.message === 'string' ? e.message.split('DETAIL:')[0].trim().slice(0, 300) : undefined

    console.error('[webhooks/delete] failed at', stage, code ?? '(no code)', error)
    return NextResponse.json(
      {
        error: 'Failed to delete webhook',
        stage,
        name: typeof e.name === 'string' ? e.name : undefined,
        code,
        detail,
        meta: e.meta,
        requestId: ctx.requestId,
      },
      { status: 500 },
    )
  }
},
)
