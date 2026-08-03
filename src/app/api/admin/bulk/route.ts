import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'
import { invalidateTokenVersionCacheBulk } from '@/lib/token-version-cache'
import { withNeonRetry } from '@/lib/resilience'
import { computeRetentionUntil } from '@/lib/soft-delete'

/**
 * POST /api/admin/bulk
 *
 * Perform bulk operations on multiple users at once.
 *
 * Body:
 *   {
 *     action: 'export' | 'change_plan' | 'message' | 'ban' | 'delete',
 *     userIds: string[],
 *     params: { plan?: string, message?: string }  // action-specific params
 *   }
 *
 * Actions:
 *   - export: Returns user data as CSV (doesn't modify anything)
 *   - change_plan: Updates all users' plan (with audit trail)
 *   - message: Creates an announcement targeting these users
 *   - ban: Sets cancelledAt + plan='free' for all users
 *   - delete: Permanently deletes users (CAREFUL — irreversible)
 */
export const POST = withAdmin(
  'admin/bulk',
  async (req: NextRequest, ctx) => {
  try {
    // Only founder can do bulk delete
    const body = await req.json()
    const { action, userIds, params = {} } = body

    if (!action || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'Action and userIds are required' }, { status: 400 })
    }

    if (userIds.length > 1000) {
      return NextResponse.json({ error: 'Max 1000 users per bulk operation' }, { status: 400 })
    }

    let result: any = {}

    switch (action) {
      case 'export': {
        const users = await db.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true, email: true, name: true, phone: true, plan: true,
            role: true, createdAt: true, updatedAt: true, renewsAt: true,
            _count: { select: { transactions: true, products: true, parties: true } },
          },
        })

        // Build CSV
        const headers = ['ID', 'Email', 'Name', 'Phone', 'Plan', 'Role', 'Joined', 'Last Active', 'Renews', 'Transactions', 'Products', 'Parties']
        const rows = users.map(u => [
          u.id, u.email, u.name || '', u.phone || '', u.plan, u.role,
          u.createdAt.toISOString(), u.updatedAt.toISOString(),
          u.renewsAt?.toISOString() || '',
          u._count.transactions, u._count.products, u._count.parties,
        ].join(','))

        const csv = [headers.join(','), ...rows].join('\n')

        return NextResponse.json({
          success: true,
          action: 'export',
          count: users.length,
          csv,
          filename: `users-export-${new Date().toISOString().split('T')[0]}.csv`,
        })
      }

      case 'change_plan': {
        if (!['free', 'pro', 'elite'].includes(params.plan)) {
          return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
        }

        /*
         * 🔒 A PLAN CHANGE MUST WRITE A SUBSCRIPTION (2026-08-03, Phase 3).
         *
         * This set `user.plan` alone. But the main app's getUserPlan() treats
         * `user.plan` as a CLAIM to be verified: for 'pro'/'elite' it looks for
         * an active, non-expired Subscription row and returns 'free' when there
         * is none (main app, src/lib/usage-limits.ts — the V26 F3 expiry fix).
         *
         * So bulk-upgrading 100 shopkeepers reported "100 users changed to pro"
         * and upgraded nobody. The admin saw success; the users stayed free.
         * The identical mistake existed in the main app's referral reward and
         * was fixed in the same pass — both predate the expiry fix, and both
         * looked correct on their own.
         *
         * Downgrades to 'free' already worked (getUserPlan returns early on a
         * free plan) but left stale 'active' rows behind, so they are expired
         * here too rather than left to contradict the user record.
         *
         * All of it in one transaction: a partial apply would leave the user
         * row and the subscription disagreeing, which is the state this whole
         * fix exists to prevent.
         */
        const now = new Date()
        const planEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

        const updated = await withNeonRetry(() =>
          db.$transaction(async (tx) => {
            const res = await tx.user.updateMany({
              where: { id: { in: userIds } },
              data: {
                plan: params.plan,
                renewsAt: params.plan === 'free' ? null : planEnd,
                // 🐛 D.4: increment tokenVersion to revoke existing JWTs
                tokenVersion: { increment: 1 },
              },
            })

            // Any previous grant is superseded by this one, in both directions.
            await tx.subscription.updateMany({
              where: { userId: { in: userIds }, status: 'active' },
              data: { status: 'expired' },
            })

            if (params.plan !== 'free') {
              await tx.subscription.createMany({
                data: userIds.map((uid: string) => ({
                  // Subscription.id has no DB default — it must be supplied.
                  id: `adminbulk_${uid}_${now.getTime()}`,
                  userId: uid,
                  plan: params.plan,
                  status: 'active',
                  amount: 0,            // granted by an admin, not paid for
                  paymentMode: 'admin_grant',
                  startDate: now,
                  endDate: planEnd,
                })),
                skipDuplicates: true,
              })
            }

            return res
          })
        )

        // 🐛 D.4: Invalidate the main app's Redis cache for all affected users
        // (pipeline — one round-trip). Non-critical (5s TTL handles it).
        await invalidateTokenVersionCacheBulk(userIds)

        await logAdminAction({
          adminId: ctx.adminId,
          action: 'bulk_plan_change',
          description: `Bulk changed ${updated.count} users to ${params.plan} (tokenVersion bumped for all)`,
          targetType: 'user',
          targetId: 'bulk',
          metadata: { userIds: userIds.slice(0, 50), count: updated.count, newPlan: params.plan, tokenVersionBumped: true },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'change_plan', count: updated.count, plan: params.plan, tokenVersionBumped: true }
        break
      }

      case 'message': {
        if (!params.title || !params.message) {
          return NextResponse.json({ error: 'Title and message required for bulk message' }, { status: 400 })
        }

        const announcement = await db.announcement.create({
          data: {
            id: `ann_bulk_${Date.now()}`,
            title: params.title,
            message: params.message,
            type: params.type || 'info',
            isActive: true,
            startsAt: new Date(),
            createdBy: ctx.email,
          },
        })

        await logAdminAction({
          adminId: ctx.adminId,
          action: 'bulk_message',
          description: `Sent "${params.title}" to ${userIds.length} users`,
          targetType: 'announcement',
          targetId: announcement.id,
          metadata: { userIds: userIds.slice(0, 50), count: userIds.length, title: params.title },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'message', count: userIds.length, announcementId: announcement.id }
        break
      }

      case 'ban': {
        // 🐛 INTEGRATION PHASE D.4: Bump tokenVersion so banned users' existing
        // JWTs are invalidated on the next request (they lose access instantly
        // instead of keeping their old plan's features for up to 7 days).
        const banned = await withNeonRetry(() =>
          db.user.updateMany({
            where: { id: { in: userIds } },
            data: {
              plan: 'free',
              cancelledAt: new Date(),
              renewsAt: null,
              // 🐛 D.4: increment tokenVersion to revoke existing JWTs
              tokenVersion: { increment: 1 },
            },
          })
        )

        // 🐛 D.4: Invalidate the main app's Redis cache for all banned users.
        await invalidateTokenVersionCacheBulk(userIds)

        await logAdminAction({
          adminId: ctx.adminId,
          action: 'bulk_ban',
          description: `Banned ${banned.count} users (set to free + cancelled, tokenVersion bumped)`,
          targetType: 'user',
          targetId: 'bulk',
          metadata: { userIds: userIds.slice(0, 50), count: banned.count, tokenVersionBumped: true },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'ban', count: banned.count, tokenVersionBumped: true }
        break
      }

      case 'delete': {
        // ═══════════════════════════════════════════════════════════════════
        // 🔒 (audit 2026-07-27) This used to run:
        //     db.user.deleteMany({ where: { id: { in: userIds } } })
        // behind a `confirm: "DELETE_PERMANENTLY"` string.
        //
        // 31 relations cascade from User, so that call permanently destroyed
        // every transaction, product, party, payment and subscription those
        // shopkeepers had ever recorded. Irreversibly, from one API call.
        //
        // It was also unlawful. GST s.36 requires those books for 72 months
        // and IT Rule 6F for 6 years. Destroying them exposes the SHOPKEEPER
        // to penalties for records they are legally required to produce —
        // for an action an admin took, not them.
        //
        // Closure is now a STATE CHANGE. The account is deactivated and hidden,
        // the books are retained until the statutory obligation expires, and a
        // separate anonymise step handles DPDP-erasable identifiers.
        // ═══════════════════════════════════════════════════════════════════
        if (ctx.role !== 'founder') {
          return NextResponse.json(
            { error: { code: 'FORBIDDEN', message: 'Only a founder may close accounts.', requestId: ctx.requestId } },
            { status: 403 },
          )
        }

        const reason = typeof params.reason === 'string' ? params.reason.trim() : ''
        if (reason.length < 10) {
          return NextResponse.json(
            {
              error: {
                code: 'REASON_REQUIRED',
                message:
                  'Provide params.reason (min 10 chars) explaining why these accounts are being closed. ' +
                  'It is written to the audit log.',
                requestId: ctx.requestId,
              },
            },
            { status: 400 },
          )
        }

        const closedAt = new Date()
        const deleted = await withNeonRetry(() =>
          db.user.updateMany({
            where: { id: { in: userIds }, deletedAt: null },
            data: {
              deletedAt: closedAt,
              deletedBy: ctx.adminId,
              deletionReason: reason,
              retentionUntil: computeRetentionUntil(closedAt),
              // 🔒 ESSENTIAL. A hard delete revoked access as a side effect of
              // the row vanishing. Soft delete leaves the row present, so
              // without this bump the closed account's existing JWTs keep
              // working in the main app until they expire — closure would be
              // cosmetic. Bumping tokenVersion is what actually locks them out.
              tokenVersion: { increment: 1 },
            },
          })
        )

        // Drop the main app's cached tokenVersion so the bump above takes
        // effect immediately rather than after the cache TTL.
        await invalidateTokenVersionCacheBulk(userIds)

        await logAdminAction({
          adminId: ctx.adminId,
          action: 'account_closed',
          description:
            `Closed ${deleted.count} account(s). Data RETAINED until ` +
            `${computeRetentionUntil(closedAt).toISOString().slice(0, 10)} ` +
            `(GST s.36 / IT Rule 6F). Reason: ${reason}`,
          targetType: 'user',
          targetId: 'bulk',
          metadata: {
            userIds: userIds.slice(0, 50),
            count: deleted.count,
            reason,
            retentionUntil: computeRetentionUntil(closedAt).toISOString(),
            destructive: false,
          },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'delete', count: deleted.count, destructive: false, retainedUntil: computeRetentionUntil(closedAt).toISOString() }
        break
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Bulk operation error:', error)
    return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 })
  }
},
)
