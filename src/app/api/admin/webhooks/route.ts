import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { VALID_EVENTS, EVENT_CONFIGS } from '@/lib/webhook-engine'
import crypto from 'crypto'

/**
 * GET /api/admin/webhooks
 * Returns webhook endpoints + stats.
 * Query: ?tab=overview|list&partnerId=all|<id>&status=all|active|disabled&page=1
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const partnerId = url.searchParams.get('partnerId') || 'all'
    const status = url.searchParams.get('status') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    if (tab === 'overview') {
      const [activeCount, disabledCount, totalSent, totalSuccess, totalFailed, pendingDeliveries] = await Promise.all([
        withTimeout(db.webhookEndpoint.count({ where: { status: 'active' } }), 5000).catch(() => 0),
        withTimeout(db.webhookEndpoint.count({ where: { status: 'disabled' } }), 5000).catch(() => 0),
        withTimeout(db.webhookEndpoint.aggregate({ _sum: { totalSent: true } }), 5000).catch(() => ({ _sum: { totalSent: 0 } })),
        withTimeout(db.webhookEndpoint.aggregate({ _sum: { totalSuccess: true } }), 5000).catch(() => ({ _sum: { totalSuccess: 0 } })),
        withTimeout(db.webhookEndpoint.aggregate({ _sum: { totalFailed: true } }), 5000).catch(() => ({ _sum: { totalFailed: 0 } })),
        withTimeout(
          db.webhookDelivery.count({ where: { status: { in: ['pending', 'retrying'] } } }),
          5000
        ).catch(() => 0),
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
          include: { partner: { select: { id: true, name: true, type: true } } },
        }),
        5000
      ).catch(() => []),
      withTimeout(db.webhookEndpoint.count({ where }), 5000).catch(() => 0),
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
    console.error('Webhooks fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch webhooks',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/webhooks
 * Create a new webhook endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    // Validate URL format
    try {
      new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
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
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
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
      error: 'Failed to create webhook',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
