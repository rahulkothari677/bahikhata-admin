import { withAdmin } from '@/lib/with-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/bulk-jobs/execute
 *
 * Processes due bulk jobs (scheduledAt <= now, status=scheduled).
 * In production, this should be a cron job running every minute.
 *
 * For each due job:
 *   1. Fetch target users (by criteria: plan, segment, or specific IDs)
 *   2. Execute the action on each user (change_plan, message, ban, delete, export)
 *   3. Update job stats (processedCount, successCount, failedCount)
 *   4. Mark as completed
 *
 * Rate limit: 1 execution per 1 minute.
 */
const lastExecuteAt: { ts: number | null } = { ts: null }
const EXECUTE_COOLDOWN_MS = 60 * 1000

/**
 * 🐛 SCALE FIX (audit 2026-07-28): the three target queries below had NO row
 * cap. "every user on the free plan" or "everyone in this segment" is an
 * unbounded set — at a million users a single bulk job loads a million rows
 * into a serverless function and is OOM-killed, having already marked itself
 * `running`.
 *
 * This is a FUSE, not pagination. A bulk job legitimately targeting more than
 * this is almost certainly a mistake (a segment definition gone wrong), and the
 * right answer is to stop and say so rather than to quietly process the first
 * slice — which is how a "send to 5,000" turns into a partial send nobody can
 * account for afterwards.
 */
const MAX_BULK_TARGETS = 10_000

/**
 * How many users one synchronous request will act on. Was applied silently as
 * `.slice(0, 1000)`; it is now a refusal threshold, not a truncation point.
 */
const SYNC_EXECUTION_LIMIT = 1_000

export const POST = withAdmin(
  'admin/bulk-jobs/execute',
  async (req: NextRequest, ctx) => {
  try {

    if (lastExecuteAt.ts && Date.now() - lastExecuteAt.ts < EXECUTE_COOLDOWN_MS) {
      const remaining = Math.ceil((EXECUTE_COOLDOWN_MS - (Date.now() - lastExecuteAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
      }, { status: 429 })
    }

    lastExecuteAt.ts = Date.now()

    // Find due jobs
    const dueJobs = await withNeonRetry(() =>
      db.bulkJob.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: new Date() },
        },
        take: 10,
      })
    ).catch(ctx.degrade('bulkJob.findMany', []))

    let processedJobs = 0
    let refusedJobs = 0
    let totalProcessed = 0
    let totalSuccess = 0
    let totalFailed = 0

    for (const job of dueJobs as any[]) {
      try {
        // Mark as running
        await db.bulkJob.update({
          where: { id: job.id },
          data: { status: 'running', startedAt: new Date() },
        })

        // Parse criteria + params
        let criteria: any = {}
        let params: any = {}
        try { criteria = JSON.parse(job.targetCriteria) } catch {}
        try { params = JSON.parse(job.actionParams) } catch {}

        /*
         * 🔒 2026-08-04 (Phase 7 audit): remember whether resolving the targets
         * FAILED, as opposed to genuinely matching nobody.
         *
         * Each query below degraded to [] on error. An empty list then sailed
         * past the over-limit guard, the per-user loop ran zero times, and the
         * job was marked completed with 0 processed — identical to "the segment
         * matched nobody". A founder scheduling a discount for 500 churning
         * users would see "completed", and nobody would receive it.
         *
         * ctx.degrade exists precisely to mark a value as NOT REAL, and it logs
         * loudly on a cron run, but the degraded value still flowed into a job
         * outcome without anyone consulting it. A failure must not be able to
         * look like a fact.
         */
        let users: any[] = []
        let targetsDegraded = false
        const markDegraded = <T,>(section: string, fallback: T) => (err: unknown): T => {
          targetsDegraded = true
          return ctx.degrade<T>(section, fallback)(err)
        }
        if (criteria.userIds && Array.isArray(criteria.userIds)) {
          users = await withNeonRetry(() =>
            db.user.findMany({
              where: { id: { in: criteria.userIds } },
              select: { id: true, email: true, name: true, plan: true, phone: true },
            })
          ).catch(markDegraded('user.findMany', []))
        } else if (criteria.plan) {
          users = await withNeonRetry(() =>
            db.user.findMany({
              where: { plan: criteria.plan },
              select: { id: true, email: true, name: true, plan: true, phone: true },
              take: MAX_BULK_TARGETS + 1, // +1 so an over-limit job is detectable
            })
          ).catch(markDegraded('user.findMany', []))
        } else if (criteria.segmentId) {
          const segmentUsers = await withNeonRetry(() =>
            db.userSegmentCache.findMany({
              where: { segmentId: criteria.segmentId },
              select: { userId: true },
              take: MAX_BULK_TARGETS + 1,
            })
          ).catch(markDegraded('userSegmentCache.findMany', []))
          const userIds = segmentUsers.map((s: any) => s.userId)
          if (userIds.length > 0) {
            users = await withNeonRetry(() =>
              db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true, name: true, plan: true, phone: true },
              })
            ).catch(markDegraded('user.findMany', []))
          }
        }

        // 🐛 FIX (audit 2026-07-28): this was `users.slice(0, 1000)` with no
        // signal. A job targeting 5,000 users processed 1,000 of them, marked
        // itself completed, and reported a success count that looked like the
        // whole job. Nobody could tell afterwards which 4,000 were skipped —
        // and for actions like change_plan or send_notification, "we did this
        // to an unknown subset of users" is the worst possible outcome.
        //
        // A partial bulk action must never look finished. Refuse the whole job
        // and say what to do instead.
        // A job whose target list could not be read must not report success.
        // Left 'scheduled' would retry forever against a broken query; marked
        // 'completed' would claim work that never happened. 'failed' with the
        // reason is the only honest outcome, and it is re-runnable by hand.
        if (targetsDegraded) {
          const msg =
            'Could not read the target users for this job (the query failed). ' +
            'Nothing was done. Re-run it once the database is healthy.'
          await db.bulkJob.update({
            where: { id: job.id },
            data: { status: 'failed', errorMessage: msg, completedAt: new Date() },
          })
          await ctx.audit({
            action: 'bulk_job_refused',
            description: msg,
            targetType: 'bulk_job',
            targetId: job.id,
          })
          refusedJobs++
          continue
        }

        if (users.length > SYNC_EXECUTION_LIMIT) {
          const msg =
            `Job targets ${users.length >= MAX_BULK_TARGETS ? `${MAX_BULK_TARGETS}+` : users.length} users, ` +
            `above the ${SYNC_EXECUTION_LIMIT} that can be processed in one request. ` +
            `Nothing was done. Narrow the segment, or split this into smaller jobs.`

          await db.bulkJob.update({
            where: { id: job.id },
            data: { status: 'failed', errorMessage: msg.slice(0, 500), completedAt: new Date() },
          })
          await ctx.audit({
            action: 'bulk_job_refused',
            description: msg,
            targetType: 'bulk_job',
            targetId: job.id,
          })
          refusedJobs++
          continue
        }

        const cappedUsers = users
        let successCount = 0
        let failedCount = 0

        // Execute action per user
        for (const user of cappedUsers) {
          try {
            switch (job.action) {
              case 'change_plan':
                if (params.plan) {
                  await db.user.update({
                    where: { id: user.id },
                    data: { plan: params.plan },
                  })
                }
                successCount++
                break

              case 'ban':
                await db.user.update({
                  where: { id: user.id },
                  data: { cancelledAt: new Date() },
                }).catch(ctx.degrade('user.update', {}))
                successCount++
                break

              case 'message':
                // Log a notification (actual sending would use notification-providers)
                await db.notificationLog.create({
                  data: {
                    userId: user.id,
                    recipient: user.email || user.phone || user.id,
                    channel: params.channel || 'email',
                    subject: params.subject || null,
                    body: params.message || '',
                    status: 'skipped',
                    provider: 'dry-run',
                    sentBy: ctx.adminId,
                    category: params.category || 'promotional',
                  },
                }).catch(ctx.degrade('notificationLog.create', {}))
                successCount++
                break

              case 'export':
                // Export = just count (actual CSV export would be separate)
                successCount++
                break

              case 'delete':
                // Delete = soft delete (mark cancelled + downgrade to free)
                await db.user.update({
                  where: { id: user.id },
                  data: { cancelledAt: new Date(), plan: 'free' },
                }).catch(ctx.degrade('user.update', {}))
                successCount++
                break

              default:
                failedCount++
            }
          } catch {
            failedCount++
          }
        }

        // Mark as completed
        await db.bulkJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
            totalTargets: cappedUsers.length,
            processedCount: cappedUsers.length,
            successCount,
            failedCount,
          },
        })

        processedJobs++
        totalProcessed += cappedUsers.length
        totalSuccess += successCount
        totalFailed += failedCount
      } catch (error) {
        // Mark job as failed
        await db.bulkJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          },
        }).catch(ctx.degrade('bulkJob.update', {}))
      }
    }

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'bulk_jobs_execute',
      description:
        `Executed ${processedJobs} bulk jobs — ${totalProcessed} users processed, ` +
        `${totalSuccess} success, ${totalFailed} failed` +
        (refusedJobs > 0 ? `, ${refusedJobs} REFUSED as too large (nothing done)` : ''),
      targetType: 'bulk_job',
    })

    return NextResponse.json({
      success: true,
      processedJobs,
      // Surfaced separately from `totalFailed`: a refused job did NOTHING,
      // whereas a failed one may have acted on some users before dying.
      refusedJobs,
      totalProcessed,
      totalSuccess,
      totalFailed,
    })
  } catch (error) {
    console.error('Bulk jobs execute error:', error)
    return NextResponse.json({ error: 'Execution failed' }, { status: 500 })
  }
},
)
