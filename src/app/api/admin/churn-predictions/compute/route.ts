import type { NextRequest } from "next/server"
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeChurnPredictions } from '@/lib/churn-prediction'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/churn-predictions/compute
 * Manually triggers churn prediction computation.
 * Rate limit: 1 compute per 5 minutes.
 */
const lastComputeAt: { ts: number | null } = { ts: null }
const COOLDOWN_MS = 5 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
    const session = isCron ? null : await getServerSession(authOptions)
    if (!isCron && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (lastComputeAt.ts && Date.now() - lastComputeAt.ts < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastComputeAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
        cooldownSeconds: remaining,
      }, { status: 429 })
    }

    lastComputeAt.ts = Date.now()

    const result = await computeChurnPredictions()

    await logAdminAction({
      adminId: (session ? (session.user as any).id : 'cron'),
      action: 'churn_prediction_compute',
      description: `Computed churn predictions for ${result.totalUsers} users — low:${result.byLevel.low} medium:${result.byLevel.medium} high:${result.byLevel.high} critical:${result.byLevel.critical} in ${result.durationMs}ms`,
      targetType: 'churn_prediction',
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Churn prediction compute error:', error)
    return NextResponse.json({ error: 'Computation failed' }, { status: 500 })
  }
}
