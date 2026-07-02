import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSegmentCounts, getSegmentUsers } from '@/lib/segments'

/**
 * GET /api/admin/segments
 *   → Returns segment counts (overview page)
 *
 * GET /api/admin/segments?segmentId=xxx&page=1&search=ram
 *   → Returns paginated users for a specific segment (detail page)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const segmentId = url.searchParams.get('segmentId')
    const page = Number(url.searchParams.get('page') || '1')
    const search = url.searchParams.get('search') || ''

    // Detail page: get paginated users for a segment
    if (segmentId) {
      const result = await getSegmentUsers(segmentId, page, 20, search)
      return NextResponse.json({ success: true, ...result })
    }

    // Overview page: get segment counts only
    const { segments, totalUsers } = await getSegmentCounts()
    return NextResponse.json({ success: true, segments, totalUsers })
  } catch (error) {
    console.error('Segments API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch segments',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
