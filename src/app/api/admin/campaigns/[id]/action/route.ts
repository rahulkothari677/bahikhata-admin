import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { sendNotification, substituteVariables } from '@/lib/notification-providers'

/**
 * POST /api/admin/campaigns/[id]/action
 *
 * Execute an action on a campaign.
 *
 * Body:
 *   - action: 'start' | 'pause' | 'cancel' | 'resume' | 'run-step'
 *   - stepId: string (required if action=run-step — manually trigger a specific step)
 *
 * Actions:
 *   - start: move from draft/scheduled → running, execute step 1 immediately
 *   - pause: move running → paused (steps already sent remain sent; pending steps wait)
 *   - resume: move paused → running (pending steps resume their schedule)
 *   - cancel: move any → cancelled (no more steps will send)
 *   - run-step: manually trigger a specific step NOW (ignores scheduledAt)
 *
 * NOTE: For production, step execution should be a background cron job that:
 *   1. Queries CampaignStep where status=pending AND scheduledAt <= now
 *   2. For each, fetches recipients (segment or userIds)
 *   3. Sends via notification-providers
 *   4. Updates step status + counts
 *
 * This route handles 'start' (executes step 1) and 'run-step' (manual trigger)
 * synchronously for immediate feedback. Scheduled future steps would be
 * handled by cron in production.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { action, stepId } = body

    const campaign = await db.campaign.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const adminId = (session.user as any).id

    // ============ START ============
    if (action === 'start') {
      if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
        return NextResponse.json({
          error: `Cannot start campaign with status "${campaign.status}"`,
        }, { status: 400 })
      }

      await db.campaign.update({
        where: { id },
        data: {
          status: 'running',
          startedAt: campaign.startedAt || new Date(),
          startAt: campaign.startAt || new Date(),
        },
      })

      await logAdminAction({
        adminId,
        action: 'campaign_start',
        description: `Started campaign "${campaign.name}"`,
        targetType: 'campaign',
        targetId: id,
      })

      return NextResponse.json({
        success: true,
        message: 'Campaign started. Steps will execute on their schedule.',
        note: 'In production, a cron job will pick up pending steps at their scheduledAt time. For testing, use run-step action to trigger manually.',
      })
    }

    // ============ PAUSE ============
    if (action === 'pause') {
      if (campaign.status !== 'running') {
        return NextResponse.json({
          error: `Cannot pause campaign with status "${campaign.status}"`,
        }, { status: 400 })
      }

      await db.campaign.update({ where: { id }, data: { status: 'paused' } })

      await logAdminAction({
        adminId,
        action: 'campaign_pause',
        description: `Paused campaign "${campaign.name}"`,
        targetType: 'campaign',
        targetId: id,
      })

      return NextResponse.json({ success: true, message: 'Campaign paused' })
    }

    // ============ RESUME ============
    if (action === 'resume') {
      if (campaign.status !== 'paused') {
        return NextResponse.json({
          error: `Cannot resume campaign with status "${campaign.status}"`,
        }, { status: 400 })
      }

      await db.campaign.update({ where: { id }, data: { status: 'running' } })

      await logAdminAction({
        adminId,
        action: 'campaign_resume',
        description: `Resumed campaign "${campaign.name}"`,
        targetType: 'campaign',
        targetId: id,
      })

      return NextResponse.json({ success: true, message: 'Campaign resumed' })
    }

    // ============ CANCEL ============
    if (action === 'cancel') {
      if (['completed', 'cancelled'].includes(campaign.status)) {
        return NextResponse.json({
          error: `Cannot cancel campaign with status "${campaign.status}"`,
        }, { status: 400 })
      }

      await db.campaign.update({
        where: { id },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      })

      // Mark all pending steps as skipped
      await db.campaignStep.updateMany({
        where: { campaignId: id, status: 'pending' },
        data: { status: 'skipped' },
      })

      await logAdminAction({
        adminId,
        action: 'campaign_cancel',
        description: `Cancelled campaign "${campaign.name}"`,
        targetType: 'campaign',
        targetId: id,
      })

      return NextResponse.json({ success: true, message: 'Campaign cancelled — pending steps marked as skipped' })
    }

    // ============ RUN-STEP (manual trigger for testing) ============
    if (action === 'run-step') {
      if (!stepId) {
        return NextResponse.json({ error: 'stepId is required for run-step action' }, { status: 400 })
      }

      const step = campaign.steps.find(s => s.id === stepId)
      if (!step) {
        return NextResponse.json({ error: 'Step not found in this campaign' }, { status: 404 })
      }

      if (step.status === 'sent') {
        return NextResponse.json({ error: 'Step already sent' }, { status: 400 })
      }

      // Mark step as running
      await db.campaignStep.update({
        where: { id: stepId },
        data: { status: 'running' },
      })

      // Fetch template
      const template = await withTimeout(
        db.notificationTemplate.findUnique({ where: { id: step.templateId } }),
        5000
      ).catch(() => null)

      if (!template) {
        await db.campaignStep.update({
          where: { id: stepId },
          data: { status: 'failed', errorMessage: 'Template not found' },
        })
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      // Fetch recipients
      let userIds: string[] = []
      if (campaign.targetSegmentId) {
        // Fetch from UserSegmentCache
        const segmentUsers = await withTimeout(
          db.userSegmentCache.findMany({
            where: { segmentId: campaign.targetSegmentId },
            select: { userId: true },
          }),
          5000
        ).catch(() => [])
        userIds = (segmentUsers as any[]).map((u: any) => u.userId)
      } else {
        try {
          userIds = JSON.parse(campaign.targetUserIds)
        } catch {
          userIds = []
        }
      }

      if (userIds.length === 0) {
        await db.campaignStep.update({
          where: { id: stepId },
          data: { status: 'skipped', errorMessage: 'No recipients' },
        })
        return NextResponse.json({
          success: true,
          message: 'Step skipped — no recipients found',
        })
      }

      // Cap at 1000 for synchronous execution (production: background job for larger batches)
      const cappedUserIds = userIds.slice(0, 1000)

      // Fetch user data
      const users = await withTimeout(
        db.user.findMany({
          where: { id: { in: cappedUserIds } },
          select: { id: true, email: true, name: true, phone: true, plan: true },
        }),
        5000
      ).catch(() => [])

      let sentCount = 0
      let failedCount = 0
      let skippedCount = 0

      // Send sequentially (avoid rate-limit bans)
      for (const user of users) {
        let address: string | null = null
        if (template.channel === 'sms') address = user.phone
        else if (template.channel === 'email') address = user.email
        else if (template.channel === 'push') address = null // future: user.deviceToken

        if (!address) {
          skippedCount++
          continue
        }

        const variables = {
          userName: user.name || 'User',
          userEmail: user.email,
          plan: user.plan,
        }

        const sendResult = await sendNotification({
          to: address,
          channel: template.channel as any,
          subject: template.subject ? substituteVariables(template.subject, variables) : undefined,
          body: substituteVariables(template.body, variables),
        })

        if (sendResult.success) {
          sentCount++
        } else if (sendResult.provider === 'dry-run') {
          skippedCount++
        } else {
          failedCount++
        }

        // Log to NotificationLog
        try {
          await db.notificationLog.create({
            data: {
              userId: user.id,
              recipient: address,
              templateId: template.id,
              templateName: template.name,
              channel: template.channel,
              subject: template.subject ? substituteVariables(template.subject, variables) : null,
              body: substituteVariables(template.body, variables),
              status: sendResult.success ? 'sent' : (sendResult.provider === 'dry-run' ? 'skipped' : 'failed'),
              provider: sendResult.provider,
              providerMessageId: sendResult.providerMessageId || null,
              errorMessage: sendResult.error || null,
              sentBy: adminId,
              category: template.category,
            },
          })
        } catch {}
      }

      // Update step stats
      await db.campaignStep.update({
        where: { id: stepId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          recipientCount: users.length,
          sentCount,
          failedCount,
          skippedCount,
        },
      })

      // Update campaign totals
      await db.campaign.update({
        where: { id },
        data: {
          totalRecipients: { increment: users.length },
          totalSent: { increment: sentCount },
          totalFailed: { increment: failedCount },
          totalSkipped: { increment: skippedCount },
          currentStep: Math.max(campaign.currentStep, step.stepNumber),
        },
      })

      // Check if all steps done → mark campaign complete
      const remainingPending = campaign.steps.filter(s => s.id !== stepId && s.status === 'pending').length
      if (remainingPending === 0) {
        await db.campaign.update({
          where: { id },
          data: { status: 'completed', completedAt: new Date() },
        })
      }

      await logAdminAction({
        adminId,
        action: 'campaign_step_run',
        description: `Manually ran step ${step.stepNumber} of campaign "${campaign.name}" — sent:${sentCount} failed:${failedCount} skipped:${skippedCount}`,
        targetType: 'campaign_step',
        targetId: stepId,
      })

      return NextResponse.json({
        success: true,
        message: `Step ${step.stepNumber} executed`,
        stats: { sentCount, failedCount, skippedCount, recipientCount: users.length },
      })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error) {
    console.error('Campaign action error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to execute action',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
