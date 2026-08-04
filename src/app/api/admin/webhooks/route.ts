import { NextRequest, NextResponse } from 'next/server'
import { assertPageDepth, PageTooDeepError } from '@/lib/pagination'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { VALID_EVENTS, EVENT_CONFIGS } from '@/lib/webhook-engine'
import { assertSafeWebhookUrl } from '@/lib/webhook-url-guard'
import crypto from 'crypto'

/**
 * GET /api/admin/webhooks
 * Returns webhook endpoints + stats.
 * Query: ?tab=overview|list&partnerId=all|<id>&status=all|active|disabled&page=1
 */
export const GET = withAdmin(
  'admin/webhooks',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const partnerId = url.searchParams.get('partnerId') || 'all'
    const status = url.searchParams.get('status') || 'all'
    const page = assertPageDepth(url.searchParams.get('page'))
    const pageSize = 20

    if (tab === 'overview') {
      const [activeCount, disabledCount, totalSent, totalSuccess, totalFailed, pendingDeliveries] = await Promise.all([
        withTimeout(db.webhookEndpoint.count({ where: { status: 'active' } }), 5000).catch(ctx.degrade('webhookEndpoint.count', 0)),
        withTimeout(db.webhookEndpoint.count({ where: { status: 'disabled' } }), 5000).catch(ctx.degrade('webhookEndpoint.count', 0)),
        withTimeout(db.webhookEndpoint.aggregate({ _sum: { totalSent: true } }), 5000).catch(ctx.degrade('webhookEndpoint.aggregate', ({ _sum: { totalSent: 0 } }))),
        withTimeout(db.webhookEndpoint.aggregate({ _sum: { totalSuccess: true } }), 5000).catch(ctx.degrade('webhookEndpoint.aggregate', ({ _sum: { totalSuccess: 0 } }))),
        withTimeout(db.webhookEndpoint.aggregate({ _sum: { totalFailed: true } }), 5000).catch(ctx.degrade('webhookEndpoint.aggregate', ({ _sum: { totalFailed: 0 } }))),
        withTimeout(
          db.webhookDelivery.count({ where: { status: { in: ['pending', 'retrying'] } } }),
          5000
        ).catch(ctx.degrade('webhookDelivery.count', 0)),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          activeCount,
          disabledCount,
          totalSent: totalSent._sum.totalSent || 0,
          totalSuccess: totalSuccess._sum.totalSuccess || 0,
          totalFailed: totalFailed._sum.totalFailed || 0,
          pendingDeliveries,
          successRate: (totalSent._sum.totalSent || 0) > 0
            ? Math.round(((totalSuccess._sum.totalSuccess || 0) / (totalSent._sum.totalSent || 1)) * 1000) / 10
            : 0,
        },
        eventConfigs: EVENT_CONFIGS,
      })
    }

    // List tab
    const skip = (page - 1) * pageSize
    const where: any = {}
    if (status !== 'all') where.status = status
    if (partnerId !== 'all') where.partnerId = partnerId

    const [endpoints, total] = await Promise.all([
      withTimeout(
        db.webhookEndpoint.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          // NOTE: Partner model deleted with the lending pipeline — no relation to include.
          // partnerName/partnerType below are always null.
        }),
        5000
      ).catch(ctx.degrade('webhookEndpoint.findMany', [])),
      withTimeout(db.webhookEndpoint.count({ where }), 5000).catch(ctx.degrade('webhookEndpoint.count', 0)),
    ])

    return NextResponse.json({
      success: true,
      endpoints: (endpoints as any[]).map((e: any) => ({
        id: e.id,
        partnerId: e.partnerId,
        partnerName: e.partner?.name || null,
        partnerType: e.partner?.type || null,
        url: e.url,
        events: (() => {
          try { return JSON.parse(e.events) } catch { return [] }
        })(),
        status: e.status,
        description: e.description,
        totalSent: e.totalSent,
        totalSuccess: e.totalSuccess,
        totalFailed: e.totalFailed,
        lastSentAt: e.lastSentAt?.toISOString() || null,
        createdAt: e.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {

    // A page-depth refusal is a CLIENT error carrying a useful message.

    // Re-throw it so withAdmin returns a typed 400; otherwise this

    // handler flattens it into a generic "failed to fetch".

    if (error instanceof PageTooDeepError) throw error
    console.error('Webhooks fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch webhooks',    }, { status: 500 })
  }
},
)

/**
 * POST /api/admin/webhooks
 * Create a new webhook endpoint.
 */
export const POST = withAdmin(
  'admin/webhooks',
  async (req: NextRequest, ctx) => {
  try {
    const body = await req.json()
    const { partnerId, url, events, description, generateSecret } = body

    if (!partnerId || !url || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json({
        error: 'partnerId, url, and events (non-empty array) are required',
      }, { status: 400 })
    }

    const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e))
    if (invalidEvents.length > 0) {
      return NextResponse.json({ error: `Invalid events: ${invalidEvents.join(', ')}` }, { status: 400 })
    }

    /*
     * 🔒 2026-08-04 (Phase 7 audit): moved into lib/webhook-url-guard.ts.
     *
     * This check was thorough and correct — and it was the ONLY place it ran.
     * PATCH /api/admin/webhooks/[id] validated URL syntax and nothing more, so
     * a webhook created here pointing at a legitimate host could be repointed
     * at http://169.254.169.254/ (cloud metadata, which serves IAM
     * credentials) in a second request. The delivery engine then fetched it
     * without re-checking and stored the first 1KB of the response in a field
     * the deliveries API returns.
     *
     * One implementation now, called by create, update, and delivery.
     */
    const verdict = await assertSafeWebhookUrl(url)
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error, detail: verdict.detail }, { status: 400 })
    }

    // 🔒 AUDIT FIX: Partner model was deleted (lending pipeline removed).
    // Skip partner validation — partnerId is now optional/decorative.
    // Webhook endpoints can exist without being tied to a Partner record.

    // Generate HMAC secret if requested
    const secret = generateSecret ? crypto.randomBytes(32).toString('hex') : null

    const endpoint = await db.webhookEndpoint.create({
      data: {
        partnerId,
        url,
        events: JSON.stringify(events),
        secret,
        description: description || null,
        status: 'active',
        createdBy: ctx.adminId,
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'webhook_create',
      description: `Created webhook endpoint for partner (URL: ${url}, events: ${events.join(', ')})`,
      targetType: 'webhook_endpoint',
      targetId: endpoint.id,
    })

    return NextResponse.json({
      success: true,
      endpoint,
      secret: secret ? 'Generated (shown once — save it now)' : null,
    })
  } catch (error) {
    console.error('Create webhook error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create webhook',    }, { status: 500 })
  }
},
)
