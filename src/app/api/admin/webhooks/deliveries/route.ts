import { NextRequest, NextResponse } from 'next/server'
import { assertPageDepth, PageTooDeepError } from '@/lib/pagination'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

/**
 * GET /api/admin/webhooks/deliveries
 * Returns webhook delivery logs (paginated + filterable).
 *
 * Query:
 *   - status: 'all' | 'pending' | 'success' | 'failed' | 'retrying'
 *   - endpointId: specific endpoint (optional)
 *   - page: number (default 1)
 */
export const GET = withAdmin(
  'admin/webhooks/deliveries',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') || 'all'
    const endpointId = url.searchParams.get('endpointId')
    const page = assertPageDepth(url.searchParams.get('page'))
    const pageSize = 20

    const skip = (page - 1) * pageSize
    const where: any = {}
    if (status !== 'all') where.status = status
    if (endpointId) where.endpointId = endpointId

    const [deliveries, total] = await Promise.all([
      withTimeout(
        db.webhookDelivery.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            // NOTE: Partner model deleted with the lending pipeline — no partner relation.
            endpoint: {
              select: { id: true, url: true },
            },
          },
        }),
        5000
      ).catch(ctx.degrade('webhookDelivery.findMany', [])),
      withTimeout(db.webhookDelivery.count({ where }), 5000).catch(ctx.degrade('webhookDelivery.count', 0)),
    ])

    return NextResponse.json({
      success: true,
      deliveries: (deliveries as any[]).map((d: any) => ({
        id: d.id,
        endpointId: d.endpointId,
        endpointUrl: d.endpoint?.url || null,
        partnerName: d.endpoint?.partner?.name || null,
        eventType: d.eventType,
        status: d.status,
        attemptCount: d.attemptCount,
        maxAttempts: d.maxAttempts,
        responseStatus: d.responseStatus,
        errorMessage: d.errorMessage,
        firstAttemptAt: d.firstAttemptAt?.toISOString() || null,
        lastAttemptAt: d.lastAttemptAt?.toISOString() || null,
        nextRetryAt: d.nextRetryAt?.toISOString() || null,
        deliveredAt: d.deliveredAt?.toISOString() || null,
        createdAt: d.createdAt.toISOString(),
        payload: d.payload.length > 500 ? d.payload.slice(0, 500) + '...' : d.payload,
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
    console.error('Delivery logs fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 })
  }
},
)
