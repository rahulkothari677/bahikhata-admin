import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const status = url.searchParams.get('status') || 'all'
    const endpointId = url.searchParams.get('endpointId')
    const page = parseInt(url.searchParams.get('page') || '1', 10)
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
            endpoint: {
              select: { id: true, url: true, partner: { select: { name: true } } },
            },
          },
        }),
        5000
      ).catch(() => []),
      withTimeout(db.webhookDelivery.count({ where }), 5000).catch(() => 0),
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
    console.error('Delivery logs fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 })
  }
}
