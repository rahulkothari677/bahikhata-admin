import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { sendNotification, substituteVariables } from '@/lib/notification-providers'
import { partitionByConsent, normaliseCategory, type Channel } from '@/lib/comms-compliance'

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
/**
 * How many people one campaign step will message in a single request.
 *
 * A FUSE, not pagination. This used to be applied as a silent
 * `userIds.slice(0, 1000)`; it is now a refusal threshold, because a campaign
 * that reports "sent" after reaching a fifth of its audience is worse than one
 * that refuses — you cannot tell afterwards who was missed, and re-running
 * double-messages everyone who already received it.
 */
const MAX_STEP_RECIPIENTS = 1_000

export const POST = withAdmin(
  'admin/campaigns/[id]/action',
  async (req: NextRequest, ctx, { params }) => {
  try {
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

    const adminId = ctx.adminId

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
      ).catch(ctx.degrade('campaignStep.update', null))

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
            // 🐛 SCALE (audit 2026-07-29): unbounded. A segment is an arbitrary
            // slice of the user base — "all free users" is every free user. The
            // +1 makes an over-limit segment DETECTABLE rather than silently
            // exactly at the cap.
            take: MAX_STEP_RECIPIENTS + 1,
          }),
          5000
        ).catch(ctx.degrade('campaignStep.update', []))
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

      // 🐛 FIX (audit 2026-07-29): this was `userIds.slice(0, 1000)` with no
      // signal — the same silent-truncation bug as bulk-jobs/execute. A campaign
      // step aimed at 5,000 people messaged 1,000 of them, marked itself sent,
      // and reported a count that read as the whole step. Nobody could say
      // afterwards which 4,000 were missed, and re-running double-messages the
      // 1,000 who already received it.
      //
      // A partial send must never look finished.
      if (userIds.length > MAX_STEP_RECIPIENTS) {
        const msg =
          `This step targets ${userIds.length > MAX_STEP_RECIPIENTS ? `${MAX_STEP_RECIPIENTS}+` : userIds.length} recipients, ` +
          `above the ${MAX_STEP_RECIPIENTS} that can be sent in one request. Nothing was sent. ` +
          `Narrow the segment, or split this into smaller campaigns.`

        await db.campaignStep.update({
          where: { id: stepId },
          data: { status: 'failed', errorMessage: msg.slice(0, 500) },
        })
        await ctx.audit({
          action: 'campaign_step_refused',
          description: `${msg} (campaign "${campaign.name}", step ${stepId})`,
          targetType: 'campaign',
          targetId: id,
        })
        return NextResponse.json(
          { success: false, error: msg, code: 'TOO_MANY_RECIPIENTS' },
          { status: 422 },
        )
      }

      const cappedUserIds = userIds

      // Fetch user data
      const allUsers = await withTimeout(
        db.user.findMany({
          where: { id: { in: cappedUserIds } },
          select: { id: true, email: true, name: true, phone: true, plan: true },
        }),
        5000
      ).catch(ctx.degrade('campaignStep.update', []))

      /*
       * 🔒 2026-08-04 (Phase 7 audit): check promotional consent HERE too.
       *
       * POST /api/admin/notifications/send does this correctly — it partitions
       * recipients by CommunicationPreference and refuses when nobody has
       * opted in. This route, which sends the same messages through the same
       * sendNotification(), did not consult consent at all. It looped over
       * every user with an address and sent.
       *
       * That is the wrong way round. A campaign is the PROMOTIONAL path by
       * definition — scheduled marketing to a segment — so the route that most
       * needs the check was the one without it, while the one-off admin send
       * that is usually service email had it.
       *
       * Under DPDP and the TRAI commercial-communication rules the absence of a
       * preference row means NO consent: silence is not opt-in. That reading is
       * already encoded in partitionByConsent and in the CommunicationPreference
       * model's own comment. Same helper, so there is one implementation of the
       * rule rather than two that can drift.
       *
       * Transactional and service categories pass through untouched — a receipt
       * is not marketing, and partitionByConsent returns everyone for those.
       */
      const category = normaliseCategory(template.category)
      let users = allUsers
      let consentBlockedCount = 0

      if (category === 'promotional') {
        const prefs = await withTimeout(
          db.communicationPreference.findMany({
            where: {
              userId: { in: allUsers.map((u: { id: string }) => u.id) },
              channel: template.channel,
              category: 'promotional',
            },
            select: { userId: true, channel: true, category: true, optedIn: true },
          }),
          5000,
        ).catch(ctx.degrade('communicationPreference.findMany', []))

        /*
         * partitionByConsent matches on `userId`, and these rows carry `id`.
         * Attach it explicitly rather than casting: a cast would satisfy the
         * compiler while `r.userId` came back undefined at runtime, so no
         * recipient would ever match an opt-in and EVERY promotional campaign
         * would silently send to nobody. That failure looks identical to
         * "nobody has opted in", which is exactly the kind of wrong answer
         * this audit keeps finding.
         */
        const withUserId = allUsers.map((u: (typeof allUsers)[number]) => ({ ...u, userId: u.id }))

        const { allowed, blocked } = partitionByConsent(
          withUserId,
          'promotional',
          template.channel as Channel,
          prefs as Array<{ userId: string; channel: string; category: string; optedIn: boolean }>,
        )
        users = allowed
        consentBlockedCount = blocked.length

        if (consentBlockedCount > 0) {
          // Recorded, not just counted: "we did not message 400 people and
          // cannot say why" is the state this exists to prevent.
          await ctx.audit({
            action: 'campaign_consent_filtered',
            description:
              `Campaign "${campaign.name}" step ${stepId}: skipped ${consentBlockedCount} of ` +
              `${allUsers.length} recipient(s) with no promotional opt-in on record.`,
            targetType: 'campaign',
            targetId: id,
            metadata: { stepId, channel: template.channel, blocked: consentBlockedCount, total: allUsers.length },
          })
        }
      }

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
    }, { status: 500 })
  }
},
)
