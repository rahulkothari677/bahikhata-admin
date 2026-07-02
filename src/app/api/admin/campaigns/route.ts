import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/campaigns
 *
 * Returns campaign analytics + paginated list.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - status: 'all' | 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled'
 *   - search: string
 *   - page: number (default 1)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const status = url.searchParams.get('status') || 'all'
    const search = url.searchParams.get('search') || ''
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const [draftCount, scheduledCount, runningCount, pausedCount, completedCount, cancelledCount, totalSent] = await Promise.all([
        withTimeout(db.campaign.count({ where: { status: 'draft' } }), 5000).catch(() => 0),
        withTimeout(db.campaign.count({ where: { status: 'scheduled' } }), 5000).catch(() => 0),
        withTimeout(db.campaign.count({ where: { status: 'running' } }), 5000).catch(() => 0),
        withTimeout(db.campaign.count({ where: { status: 'paused' } }), 5000).catch(() => 0),
        withTimeout(db.campaign.count({ where: { status: 'completed' } }), 5000).catch(() => 0),
        withTimeout(db.campaign.count({ where: { status: 'cancelled' } }), 5000).catch(() => 0),
        withTimeout(
          db.campaign.aggregate({ _sum: { totalSent: true } }),
          5000
        ).catch(() => ({ _sum: { totalSent: 0 } })),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          draftCount,
          scheduledCount,
          runningCount,
          pausedCount,
          completedCount,
          cancelledCount,
          totalCount: draftCount + scheduledCount + runningCount + pausedCount + completedCount + cancelledCount,
          activeCount: runningCount + scheduledCount,
          totalNotificationsSent: totalSent._sum.totalSent || 0,
        },
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    const where: any = {}
    if (status !== 'all') where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [campaigns, total] = await Promise.all([
      withTimeout(
        db.campaign.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            _count: { select: { steps: true } },
          },
        }),
        5000
      ).catch(() => []),
      withTimeout(db.campaign.count({ where }), 5000).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      campaigns: (campaigns as any[]).map((c: any) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        targetSegmentId: c.targetSegmentId,
        targetUserIds: c.targetUserIds,
        startAt: c.startAt?.toISOString() || null,
        endAt: c.endAt?.toISOString() || null,
        totalRecipients: c.totalRecipients,
        totalSent: c.totalSent,
        totalFailed: c.totalFailed,
        totalSkipped: c.totalSkipped,
        currentStep: c.currentStep,
        stepCount: c._count?.steps || 0,
        createdBy: c.createdBy,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        startedAt: c.startedAt?.toISOString() || null,
        completedAt: c.completedAt?.toISOString() || null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Campaigns fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch campaigns',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/campaigns
 * Create a new campaign with steps.
 *
 * Body:
 *   - name: string (required)
 *   - description: string (optional)
 *   - targetSegmentId: string (optional — use segment as audience)
 *   - targetUserIds: string[] (optional — manual user list, ignored if segmentId set)
 *   - startAt: ISO string (optional — if not set, status=draft)
 *   - steps: Array<{ templateId, delayMinutes }> (required, min 1 step)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, description, targetSegmentId, targetUserIds, startAt, steps } = body

    // Validate
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'At least 1 step is required' }, { status: 400 })
    }
    if (!targetSegmentId && (!Array.isArray(targetUserIds) || targetUserIds.length === 0)) {
      return NextResponse.json({ error: 'Either targetSegmentId or targetUserIds is required' }, { status: 400 })
    }

    // Validate all template IDs exist
    const templateIds = steps.map((s: any) => s.templateId)
    const templates = await withTimeout(
      db.notificationTemplate.findMany({
        where: { id: { in: templateIds } },
        select: { id: true, name: true, channel: true, status: true },
      }),
      5000
    ).catch(() => [])

    if (templates.length !== templateIds.length) {
      return NextResponse.json({ error: 'One or more template IDs are invalid' }, { status: 400 })
    }

    // Check all templates are active
    const inactiveTemplates = templates.filter((t: any) => t.status !== 'active')
    if (inactiveTemplates.length > 0) {
      return NextResponse.json({
        error: `Templates must be active: ${inactiveTemplates.map((t: any) => t.name).join(', ')}`,
      }, { status: 400 })
    }

    // Sort steps by stepNumber (1, 2, 3...)
    const sortedSteps = steps
      .map((s: any, i: number) => ({ ...s, stepNumber: i + 1 }))
      .sort((a: any, b: any) => a.stepNumber - b.stepNumber)

    // Compute endAt = startAt + max delay
    let endAt: Date | null = null
    let status = 'draft'
    let startAtDate: Date | null = null
    if (startAt) {
      startAtDate = new Date(startAt)
      const maxDelayMin = Math.max(...sortedSteps.map((s: any) => s.delayMinutes || 0))
      endAt = new Date(startAtDate.getTime() + maxDelayMin * 60 * 1000)
      status = startAtDate > new Date() ? 'scheduled' : 'running'
    }

    // Create campaign + steps in a transaction
    const campaign = await db.campaign.create({
      data: {
        name: name.trim(),
        description: description || null,
        status,
        targetSegmentId: targetSegmentId || null,
        targetUserIds: JSON.stringify(targetUserIds || []),
        startAt: startAtDate,
        endAt,
        createdBy: (session.user as any).id,
        startedAt: status === 'running' ? new Date() : null,
        steps: {
          create: sortedSteps.map((s: any) => {
            const template = templates.find((t: any) => t.id === s.templateId)
            const scheduledAt = startAtDate
              ? new Date(startAtDate.getTime() + (s.delayMinutes || 0) * 60 * 1000)
              : null
            return {
              stepNumber: s.stepNumber,
              templateId: s.templateId,
              templateName: template?.name || null,
              delayMinutes: s.delayMinutes || 0,
              status: 'pending',
              scheduledAt,
            }
          }),
        },
      },
      include: { steps: true },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'campaign_create',
      description: `Created campaign "${name}" with ${sortedSteps.length} step(s), status=${status}`,
      targetType: 'campaign',
      targetId: campaign.id,
    })

    return NextResponse.json({ success: true, campaign })
  } catch (error) {
    console.error('Create campaign error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create campaign',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
