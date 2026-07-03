import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { detectAnomalies } from '@/lib/anomaly-detection'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/anomalies/detect
 *
 * Manually triggers anomaly detection across all tracked metrics.
 * Returns the results + count of new anomalies saved to DB.
 *
 * In production, this should be called by a daily cron job (e.g. Vercel Cron
 * hitting this endpoint at 2 AM IST). For now, admin can trigger manually.
 *
 * Auth: requires admin session.
 * Rate limit: 1 detection per 5 minutes (prevents abuse).
 */
const lastDetectAt: { ts: number | null } = { ts: null }
const DETECT_COOLDOWN_MS = 5 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
    const session = isCron ? null : await getServerSession(authOptions)
    if (!isCron && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Cooldown check
    if (lastDetectAt.ts && Date.now() - lastDetectAt.ts < DETECT_COOLDOWN_MS) {
      const remaining = Math.ceil((DETECT_COOLDOWN_MS - (Date.now() - lastDetectAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
        cooldownSeconds: remaining,
      }, { status: 429 })
    }

    lastDetectAt.ts = Date.now()

    const result = await detectAnomalies()

    await logAdminAction({
      adminId: (session ? (session.user as any).id : 'cron'),
      action: 'anomaly_detection_run',
      description: `Ran anomaly detection — ${result.totalMetricsChecked} metrics checked, ${result.newAnomalies} new anomalies in ${result.durationMs}ms`,
      targetType: 'anomaly_detection',
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('Anomaly detection error:', error)
    return NextResponse.json({
      success: false,
      error: 'Detection failed',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * GET /api/admin/anomalies/detect
 * Returns cooldown status.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const cooldownRemaining = lastDetectAt.ts
      ? Math.max(0, DETECT_COOLDOWN_MS - (Date.now() - lastDetectAt.ts))
      : 0

    return NextResponse.json({
      canDetect: cooldownRemaining === 0,
      cooldownRemainingMs: cooldownRemaining,
      cooldownRemainingSeconds: Math.ceil(cooldownRemaining / 1000),
    })
  } catch {
    return NextResponse.json({ canDetect: true, cooldownRemainingMs: 0 })
  }
}
