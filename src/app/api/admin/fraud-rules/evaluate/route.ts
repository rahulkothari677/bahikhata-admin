import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { evaluateAllRules } from '@/lib/fraud-rules-engine'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/fraud-rules/evaluate
 *
 * Manually triggers evaluation of all enabled fraud rules.
 * Returns a summary of alerts created per rule.
 *
 * In production, this should be called by a cron job (e.g. every 15 minutes).
 *
 * Auth: requires admin session.
 * Rate limit: 1 evaluation per 5 minutes.
 */
const lastEvalAt: { ts: number | null } = { ts: null }
const EVAL_COOLDOWN_MS = 5 * 60 * 1000

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (lastEvalAt.ts && Date.now() - lastEvalAt.ts < EVAL_COOLDOWN_MS) {
      const remaining = Math.ceil((EVAL_COOLDOWN_MS - (Date.now() - lastEvalAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
        cooldownSeconds: remaining,
      }, { status: 429 })
    }

    lastEvalAt.ts = Date.now()

    const result = await evaluateAllRules()

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'fraud_rules_evaluation',
      description: `Evaluated ${result.totalRules} fraud rules — ${result.totalAlertsCreated} new alerts in ${result.durationMs}ms`,
      targetType: 'fraud_rules',
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('Fraud rules evaluation error:', error)
    return NextResponse.json({
      success: false,
      error: 'Evaluation failed',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const cooldownRemaining = lastEvalAt.ts
      ? Math.max(0, EVAL_COOLDOWN_MS - (Date.now() - lastEvalAt.ts))
      : 0

    return NextResponse.json({
      canEvaluate: cooldownRemaining === 0,
      cooldownRemainingMs: cooldownRemaining,
      cooldownRemainingSeconds: Math.ceil(cooldownRemaining / 1000),
    })
  } catch {
    return NextResponse.json({ canEvaluate: true, cooldownRemainingMs: 0 })
  }
}
