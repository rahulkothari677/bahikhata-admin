import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getProviderStatus } from '@/lib/notification-providers'

/**
 * GET /api/admin/notifications/status
 *
 * Returns which notification providers are configured (env vars set).
 * Used by the UI to show:
 *   "SMS (MSG91): ✓ Configured" or "SMS: ✗ Not set — running in dry-run mode"
 *
 * No DB query — pure env var check. Instant, O(1).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const status = getProviderStatus()

    return NextResponse.json({
      success: true,
      providers: status,
      anyConfigured: status.sms.configured || status.email.configured || status.push.configured,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch provider status',
    }, { status: 500 })
  }
}
