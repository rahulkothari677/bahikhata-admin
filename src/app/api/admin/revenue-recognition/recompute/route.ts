import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      adminId: (session.user as any).id,
      action: 'revenue_recognition_recompute',
      description: `Recomputed revenue schedules — ${result.subscriptionsProcessed} subscriptions, ${result.entriesCreated} entries in ${result.durationMs}ms`,
      targetType: 'revenue_schedule',
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('Revenue recompute error:', error)
    return NextResponse.json({
      success: false,
      error: 'Recompute failed',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
}
