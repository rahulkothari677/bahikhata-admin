import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/notification-templates
 *
 * Returns notification templates with bulk aggregate KPIs + paginated list.
 * Scales to thousands of templates.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - channel: 'all' | 'sms' | 'email' | 'push' (filter for list tab)
 *   - category: 'all' | 'general' | 'payment' | 'onboarding' | 'churn' | 'promotional'
 *   - status: 'all' | 'draft' | 'active' | 'archived'
 *   - search: string (search by name or body)
 *   - page: number (default 1)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const channel = url.searchParams.get('channel') || 'all'
    const category = url.searchParams.get('category') || 'all'
    const status = url.searchParams.get('status') || 'all'
    const search = url.searchParams.get('search') || ''
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      // 4 parallel count queries — all O(1)
      const [activeCount, draftCount, archivedCount, channelDist] = await Promise.all([
        withTimeout(
          db.notificationTemplate.count({ where: { status: 'active' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.notificationTemplate.count({ where: { status: 'draft' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.notificationTemplate.count({ where: { status: 'archived' } }),
          5000
        ).catch(() => 0),

        withTimeout(
          db.notificationTemplate.groupBy({
            by: ['channel'],
            where: { status: 'active' },
            _count: true,
          }),
          5000
        ).catch(() => []),
      ])

      const channelMap: Record<string, number> = { sms: 0, email: 0, push: 0 }
      for (const c of channelDist as any[]) {
        channelMap[c.channel] = c._count
      }

      return NextResponse.json({
        success: true,
        overview: {
          activeCount,
          draftCount,
          archivedCount,
          totalCount: activeCount + draftCount + archivedCount,
        },
        channelDistribution: channelMap,
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    const where: any = {}
    if (channel !== 'all') where.channel = channel
    if (category !== 'all') where.category = category
    if (status !== 'all') where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [templates, total] = await Promise.all([
      withTimeout(
        db.notificationTemplate.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: pageSize,
        }),
        5000
      ).catch(() => []),
      withTimeout(
        db.notificationTemplate.count({ where }),
        5000
      ).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      templates: (templates as any[]).map((t: any) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        channel: t.channel,
        subject: t.subject,
        body: t.body,
        variables: t.variables,
        language: t.language,
        status: t.status,
        version: t.version,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Notification templates fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch templates',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/notification-templates
 * Create a new notification template.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, category, channel, subject, body: templateBody, variables, language, status } = body

    // Validate required fields
    if (!name || !channel || !templateBody) {
      return NextResponse.json({
        error: 'Missing required fields: name, channel, body',
      }, { status: 400 })
    }

    if (!['sms', 'email', 'push'].includes(channel)) {
      return NextResponse.json({ error: 'Invalid channel (must be sms, email, or push)' }, { status: 400 })
    }

    if (channel === 'email' && !subject) {
      return NextResponse.json({ error: 'Email templates require a subject' }, { status: 400 })
    }

    // Extract variables from body using {{varName}} pattern (auto-detection)
    const detectedVars = Array.from(templateBody.matchAll(/\{\{(\w+)\}\}/g) as IterableIterator<RegExpMatchArray>).map(m => m[1])
    const uniqueDetectedVars = Array.from(new Set(detectedVars))
    const providedVars = Array.isArray(variables) ? variables : []
    const allVars = Array.from(new Set([...providedVars, ...uniqueDetectedVars]))

    const template = await db.notificationTemplate.create({
      data: {
        name,
        category: category || 'general',
        channel,
        subject: subject || null,
        body: templateBody,
        variables: JSON.stringify(allVars),
        language: language || 'en',
        status: status || 'draft',
        version: 1,
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'notification_template_create',
      description: `Created ${channel} template "${name}"`,
      targetType: 'notification_template',
      targetId: template.id,
    })

    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error('Create template error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create template',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
