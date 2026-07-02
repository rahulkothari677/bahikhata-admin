import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/campaigns/segments
 *
 * Returns all available user segments with user counts.
 * Used by the Campaign Editor dropdown (instead of manually typing segment ID).
 *
 * Reads from UserSegmentCache (pre-computed by background job).
 * Returns: [{ segmentId, userCount }]
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Group by segmentId to get count per segment
    const segments = await withNeonRetry(() =>
      db.userSegmentCache.groupBy({
        by: ['segmentId'],
        _count: true,
        orderBy: { _count: { segmentId: 'desc' } },
      })
    ).catch(() => [])

    // Human-readable segment names
    const SEGMENT_NAMES: Record<string, string> = {
      power_users: '⚡ Power Users',
      whales: '🐋 Whales',
      new_users: '🆕 New Users',
      at_risk: '⚠️ At Risk',
      churned: '💀 Churned',
      ai_power: '🤖 AI Power Users',
      free_active: '🆓 Free Tier Active',
      paying: '👑 Paying Users',
      abandoned: '🚫 Trial Abandoned',
      rising_stars: '🌟 Rising Stars',
    }

    return NextResponse.json({
      success: true,
      segments: (segments as any[]).map((s: any) => ({
        segmentId: s.segmentId,
        name: SEGMENT_NAMES[s.segmentId] || s.segmentId,
        userCount: s._count,
      })),
    })
  } catch (error) {
    console.error('Campaign segments fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 })
  }
}
