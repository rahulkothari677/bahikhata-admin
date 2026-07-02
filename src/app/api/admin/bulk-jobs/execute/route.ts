import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    ).catch(() => [])

    let processedJobs = 0
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

        // Fetch target users
        let users: any[] = []
        if (criteria.userIds && Array.isArray(criteria.userIds)) {
          users = await withNeonRetry(() =>
            db.user.findMany({
              where: { id: { in: criteria.userIds } },
              select: { id: true, email: true, name: true, plan: true, phone: true },
            })
          ).catch(() => [])
        } else if (criteria.plan) {
          users = await withNeonRetry(() =>
            db.user.findMany({
              where: { plan: criteria.plan },
              select: { id: true, email: true, name: true, plan: true, phone: true },
            })
          ).catch(() => [])
        } else if (criteria.segmentId) {
          const segmentUsers = await withNeonRetry(() =>
            db.userSegmentCache.findMany({
              where: { segmentId: criteria.segmentId },
              select: { userId: true },
            })
          ).catch(() => [])
          const userIds = segmentUsers.map((s: any) => s.userId)
          if (userIds.length > 0) {
            users = await withNeonRetry(() =>
              db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true, name: true, plan: true, phone: true },
              })
            ).catch(() => [])
          }
        }

        // Cap at 1000 for synchronous execution
        const cappedUsers = users.slice(0, 1000)
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
                }).catch(() => {})
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
                    sentBy: (session.user as any).id,
                    category: params.category || 'promotional',
                  },
                }).catch(() => {})
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
                }).catch(() => {})
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
        }).catch(() => {})
      }
    }

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'bulk_jobs_execute',
      description: `Executed ${processedJobs} bulk jobs — ${totalProcessed} users processed, ${totalSuccess} success, ${totalFailed} failed`,
      targetType: 'bulk_job',
    })

    return NextResponse.json({
      success: true,
      processedJobs,
      totalProcessed,
      totalSuccess,
      totalFailed,
    })
  } catch (error) {
    console.error('Bulk jobs execute error:', error)
    return NextResponse.json({ error: 'Execution failed' }, { status: 500 })
  }
}
