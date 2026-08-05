import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/campaigns/[id]
 * Returns a single campaign with all its steps.
 */
export const GET = withAdmin(
  'admin/campaigns/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const campaign = await withTimeout(
      db.campaign.findUnique({
        where: { id },
        include: {
          steps: {
            orderBy: { stepNumber: 'asc' },
          },
        },
      }),
      5000
    ).catch(ctx.degrade('campaign.findUnique', null))

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      campaign: {
        ...campaign,
        startAt: campaign.startAt?.toISOString() || null,
        endAt: campaign.endAt?.toISOString() || null,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
        startedAt: campaign.startedAt?.toISOString() || null,
        completedAt: campaign.completedAt?.toISOString() || null,
        steps: campaign.steps.map((s: any) => ({
          ...s,
          scheduledAt: s.scheduledAt?.toISOString() || null,
          sentAt: s.sentAt?.toISOString() || null,
        })),
      },
    })
  } catch (error) {
    console.error('[admin/campaigns/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to fetch campaign' }, { status: 500 })
  }
},
)

/**
 * PATCH /api/admin/campaigns/[id]
 * Update campaign basic fields (name, description, startAt).
 * Steps cannot be edited after creation (for audit trail integrity).
 * To change steps, cancel this campaign and create a new one.
 */
export const PATCH = withAdmin(
  'admin/campaigns/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, description, startAt } = body

    const existing = await db.campaign.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Cannot edit running/completed campaigns
    if (['running', 'completed', 'cancelled'].includes(existing.status)) {
      return NextResponse.json({
        error: `Cannot edit campaign with status "${existing.status}". Cancel it and create a new one.`,
      }, { status: 400 })
    }

    let startAtDate: Date | null = null
    let endAt: Date | null = null
    let status = existing.status

    if (startAt !== undefined) {
      startAtDate = startAt ? new Date(startAt) : null
      if (startAtDate) {
        // Recompute endAt based on max step delay
        const steps = await db.campaignStep.findMany({
          where: { campaignId: id },
          select: { delayMinutes: true },
          // Fuse. A campaign is a handful of steps by design; reading unbounded
          // here only pays off when the data is already corrupt.
          take: 500,
        })
        const maxDelay = Math.max(...steps.map(s => s.delayMinutes || 0), 0)
        endAt = new Date(startAtDate.getTime() + maxDelay * 60 * 1000)
        status = startAtDate > new Date() ? 'scheduled' : 'running'

        // Update step scheduledAt times
        for (const step of steps) {
          // We need delayMinutes per step — fetch with it
        }
        const stepsWithDelay = await db.campaignStep.findMany({
          where: { campaignId: id },
          select: { id: true, delayMinutes: true },
          take: 500, // same fuse as above
        })
        for (const step of stepsWithDelay) {
          await db.campaignStep.update({
            where: { id: step.id },
            data: {
              scheduledAt: new Date(startAtDate.getTime() + step.delayMinutes * 60 * 1000),
            },
          })
        }
      } else {
        status = 'draft'
      }
    }

    const updated = await db.campaign.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(startAt !== undefined && { startAt: startAtDate, endAt, status }),
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'campaign_update',
      description: `Updated campaign "${existing.name}"`,
      targetType: 'campaign',
      targetId: id,
    })

    return NextResponse.json({ success: true, campaign: updated })
  } catch (error) {
    console.error('Update campaign error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update campaign',    }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/campaigns/[id]
 * Hard delete (campaign + all steps cascade).
 * Only allowed for draft or cancelled campaigns.
 */
export const DELETE = withAdmin(
  'admin/campaigns/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.campaign.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (!['draft', 'cancelled'].includes(existing.status)) {
      return NextResponse.json({
        error: `Cannot delete campaign with status "${existing.status}". Cancel it first.`,
      }, { status: 400 })
    }

    await db.campaign.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'campaign_delete',
      description: `Deleted campaign "${existing.name}"`,
      targetType: 'campaign',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Campaign deleted' })
  } catch (error) {
    console.error('Delete campaign error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete campaign',    }, { status: 500 })
  }
},
)
