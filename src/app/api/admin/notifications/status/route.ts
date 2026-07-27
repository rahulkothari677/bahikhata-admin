import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
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
export const GET = withAdmin(
  'admin/notifications/status',
  async (req: NextRequest, ctx) => {
  try {
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
},
)
