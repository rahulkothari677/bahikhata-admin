import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

/**
 * GET /api/admin/notifications/log
 *
 * Returns notification send history (from NotificationLog) with bulk aggregate
 * KPIs + paginated list. Scales to millions of log rows.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - channel: 'all' | 'sms' | 'email' | 'push'
 *   - status: 'all' | 'sent' | 'failed' | 'skipped' | 'pending'
 *   - search: string (search by recipient or templateName)
 *   - page: number (default 1)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const channel = url.searchParams.get('channel') || 'all'
    const status = url.searchParams.get('status') || 'all'
    const search = url.searchParams.get('search') || ''
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      // 5 parallel count queries — all O(1)
      const [sentCount, failedCount, skippedCount, totalCount, channelDist] = await Promise.all([
        withTimeout(
          db.notificationLog.count({ where: { status: 'sent' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.notificationLog.count({ where: { status: 'failed' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.notificationLog.count({ where: { status: 'skipped' } }),
          5000
        ).catch(() => 0),

        withTimeout(db.notificationLog.count(), 5000).catch(() => 0),

        withTimeout(
          db.notificationLog.groupBy({
            by: ['channel'],
            _count: true,
          }),
          5000
        ).catch(() => []),
      ])

      // Recent sends (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const recent7d = await withTimeout(
        db.notificationLog.count({ where: { sentAt: { gte: sevenDaysAgo } } }),
        5000
      ).catch(() => 0)

      const channelMap: Record<string, number> = { sms: 0, email: 0, push: 0 }
      for (const c of channelDist as any[]) {
        channelMap[c.channel] = c._count
      }

      const successRate = totalCount > 0
        ? Math.round((sentCount / totalCount) * 1000) / 10
        : 0

      return NextResponse.json({
        success: true,
        overview: {
          totalCount,
          sentCount,
          failedCount,
          skippedCount,
          recent7d,
          successRate,
        },
        channelDistribution: channelMap,
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    const where: any = {}
    if (channel !== 'all') where.channel = channel
    if (status !== 'all') where.status = status
    if (search) {
      where.OR = [
        { recipient: { contains: search, mode: 'insensitive' } },
        { templateName: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [logs, total] = await Promise.all([
      withTimeout(
        db.notificationLog.findMany({
          where,
          orderBy: { sentAt: 'desc' },
          skip,
          take: pageSize,
        }),
        5000
      ).catch(() => []),
      withTimeout(
        db.notificationLog.count({ where }),
        5000
      ).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      logs: (logs as any[]).map((l: any) => ({
        id: l.id,
        userId: l.userId,
        recipient: l.recipient,
        templateId: l.templateId,
        templateName: l.templateName,
        channel: l.channel,
        subject: l.subject,
        body: l.body,
        status: l.status,
        provider: l.provider,
        providerMessageId: l.providerMessageId,
        errorMessage: l.errorMessage,
        sentBy: l.sentBy,
        sentAt: l.sentAt.toISOString(),
        category: l.category,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Notification log fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch notification logs',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
