import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeAndCacheAllScores } from '@/lib/credit-score'

/**
 * POST /api/admin/data-monetization/compute
 *
 * Triggers the background job that computes ALL user credit scores
 * using 5 bulk groupBy queries (NOT 4*N) and writes them to CreditScoreCache.
 *
 * Should be triggered:
 *   - Manually by admin from the Data Monetization page
 *   - Daily via cron (e.g. Vercel Cron, Railway Cron, or external scheduler)
 *
 * Returns: { success, totalScored, byBand, avgScore, durationMs }
 *
 * Auth: requires admin session.
 * Rate limit: 1 compute per 5 minutes (in-memory, prevents abuse).
 */
const lastComputeAt: { ts: number | null } = { ts: null }
const COMPUTE_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Cooldown check (prevent accidental double-trigger)
    if (lastComputeAt.ts && Date.now() - lastComputeAt.ts < COMPUTE_COOLDOWN_MS) {
      const remaining = Math.ceil((COMPUTE_COOLDOWN_MS - (Date.now() - lastComputeAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
        cooldownSeconds: remaining,
      }, { status: 429 })
    }

    lastComputeAt.ts = Date.now()

    const result = await computeAndCacheAllScores()

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: 'Compute failed',
        detail: result.error,
      }, { status: 500 })
    }

    return NextResponse.json({
      ...result,
      success: true,
    })
  } catch (error) {
    console.error('Compute credit scores error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to compute',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * GET /api/admin/data-monetization/compute
 * Returns whether a compute is currently allowed (cooldown status).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const cooldownRemaining = lastComputeAt.ts
      ? Math.max(0, COMPUTE_COOLDOWN_MS - (Date.now() - lastComputeAt.ts))
      : 0

    return NextResponse.json({
      canCompute: cooldownRemaining === 0,
      cooldownRemainingMs: cooldownRemaining,
      cooldownRemainingSeconds: Math.ceil(cooldownRemaining / 1000),
    })
  } catch (error) {
    return NextResponse.json({ canCompute: true, cooldownRemainingMs: 0 }, { status: 200 })
  }
}
