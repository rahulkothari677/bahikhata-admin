import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { computeAllRevenueSchedules } from '@/lib/revenue-recognition'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/revenue-recognition/recompute
 *
 * Recomputes ALL revenue schedules from scratch.
 * Deletes existing schedules and recreates them for all subscriptions.
 *
 * Use cases:
 *   - Initial setup (first time enabling revenue recognition)
 *   - After schema changes or data migrations
 *   - If schedules get out of sync with subscriptions
 *
 * Rate limit: 1 recompute per 10 minutes (heavy operation)
 */
const lastRecomputeAt: { ts: number | null } = { ts: null }
const RECOMPUTE_COOLDOWN_MS = 10 * 60 * 1000

export const POST = withAdmin(
  'admin/revenue-recognition/recompute',
  async (req: NextRequest, ctx) => {
  try {
    if (lastRecomputeAt.ts && Date.now() - lastRecomputeAt.ts < RECOMPUTE_COOLDOWN_MS) {
      const remaining = Math.ceil((RECOMPUTE_COOLDOWN_MS - (Date.now() - lastRecomputeAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
        cooldownSeconds: remaining,
      }, { status: 429 })
    }

    lastRecomputeAt.ts = Date.now()

    const result = await computeAllRevenueSchedules()

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'revenue_recognition_recompute',
      description:
        `Recomputed revenue schedules — ${result.subscriptionsProcessed}/${result.subscriptionsFound} subscriptions` +
        `, ${result.entriesCreated} entries in ${result.durationMs}ms` +
        (result.failed > 0 ? ` — ${result.failed} FAILED: ${result.firstError}` : ''),
      targetType: 'revenue_schedule',
    })

    /*
     * 🔒 2026-08-05: a run where every subscription failed is not a success.
     *
     * This returned `success: true` with the full subscription count regardless
     * of how many actually failed, because computeAllRevenueSchedules() dropped
     * its errors. And every one WAS failing — the database role cannot DELETE
     * from RevenueSchedule, which that function does before recomputing. The
     * operator saw a healthy-looking count while recognised revenue quietly
     * stopped moving.
     *
     * The HTTP status stays 200 on a partial failure, deliberately: the request
     * did run, and 200-with-a-count is what distinguishes "some subscriptions
     * are broken" from "the endpoint is down". `success` is what says whether
     * the work was actually done.
     */
    return NextResponse.json({
      success: result.failed === 0,
      ...result,
      ...(result.failed > 0 && {
        warning:
          `${result.failed} of ${result.subscriptionsFound} subscriptions failed to recompute. ` +
          `Recognised revenue is stale for those. First error: ${result.firstError}`,
      }),
    })
  } catch (error) {
    console.error('Revenue recompute error:', error)
    return NextResponse.json({
      success: false,
      error: 'Recompute failed',    }, { status: 500 })
  }
},
)

export const GET = withAdmin(
  'admin/revenue-recognition/recompute',
  async (req: NextRequest, ctx) => {
  try {
    const cooldownRemaining = lastRecomputeAt.ts
      ? Math.max(0, RECOMPUTE_COOLDOWN_MS - (Date.now() - lastRecomputeAt.ts))
      : 0

    return NextResponse.json({
      canRecompute: cooldownRemaining === 0,
      cooldownRemainingMs: cooldownRemaining,
      cooldownRemainingSeconds: Math.ceil(cooldownRemaining / 1000),
    })
  } catch {
    return NextResponse.json({ canRecompute: true, cooldownRemainingMs: 0 })
  }
},
)
