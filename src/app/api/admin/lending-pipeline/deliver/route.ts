import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deliverLeadsToPartners } from '@/lib/lending-pipeline'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/lending-pipeline/deliver
 *
 * Delivers credit-scored leads to NBFC partners via webhooks.
 *
 * Body:
 *   - minScore: number (default 550 — exclude poor band)
 *   - maxLeads: number (default 100)
 *   - band: string (optional — deliver only specific band)
 *
 * Rate limit: 1 delivery per 5 minutes.
 */
const lastDeliverAt: { ts: number | null } = { ts: null }
const COOLDOWN_MS = 5 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (lastDeliverAt.ts && Date.now() - lastDeliverAt.ts < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastDeliverAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
        cooldownSeconds: remaining,
      }, { status: 429 })
    }

    lastDeliverAt.ts = Date.now()

    const body = await req.json().catch(() => ({}))
    const result = await deliverLeadsToPartners({
      minScore: body.minScore || 550,
      maxLeads: body.maxLeads || 100,
      band: body.band,
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'lending_pipeline_deliver',
      description: `Delivered ${result.eligibleLeads} leads to ${result.delivered} partner endpoints — revenue: ₹${result.revenue} in ${result.durationMs}ms`,
      targetType: 'lending_pipeline',
      metadata: {
        totalCandidates: result.totalCandidates,
        eligibleLeads: result.eligibleLeads,
        delivered: result.delivered,
        revenue: result.revenue,
      },
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Lead delivery error:', error)
    return NextResponse.json({ error: 'Delivery failed' }, { status: 500 })
  }
}
