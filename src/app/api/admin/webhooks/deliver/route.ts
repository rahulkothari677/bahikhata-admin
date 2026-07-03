import type { NextRequest } from "next/server"
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { processPendingDeliveries } from '@/lib/webhook-engine'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/webhooks/deliver
 * Manually trigger processing of pending webhook deliveries.
 * In production, this should be a cron job running every minute.
 *
 * Rate limit: 1 trigger per 1 minute.
 */
const lastTriggerAt: { ts: number | null } = { ts: null }
const COOLDOWN_MS = 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
    const session = isCron ? null : await getServerSession(authOptions)
    if (!isCron && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (lastTriggerAt.ts && Date.now() - lastTriggerAt.ts < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastTriggerAt.ts)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Cooldown active. Try again in ${remaining}s.`,
      }, { status: 429 })
    }

    lastTriggerAt.ts = Date.now()

    const result = await processPendingDeliveries()

    await logAdminAction({
      adminId: (session ? (session.user as any).id : 'cron'),
      action: 'webhook_deliver_run',
      description: `Processed ${result.processed} deliveries — success: ${result.succeeded}, retrying: ${result.retrying}, failed: ${result.failed}`,
      targetType: 'webhook_delivery',
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Webhook delivery error:', error)
    return NextResponse.json({ error: 'Delivery failed' }, { status: 500 })
  }
}
