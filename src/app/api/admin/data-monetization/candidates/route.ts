import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTopLendingCandidates } from '@/lib/credit-score'

/**
 * GET /api/admin/data-monetization/candidates
 *
 * Returns paginated list of top lending candidates from CreditScoreCache.
 * Reads ONLY from cache (instant, scales to millions).
 *
 * Query params:
 *   - page: number (default 1)
 *   - pageSize: number (default 20, max 100)
 *   - band: 'excellent' | 'good' | 'fair' | 'poor' (optional filter)
 *   - minScore: number (optional, e.g. 700)
 *
 * Returns: { candidates, total, page, pageSize, totalPages, cacheStaleAt }
 *
 * To populate the cache, POST /api/admin/data-monetization/compute
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10)
    const band = url.searchParams.get('band') as 'excellent' | 'good' | 'fair' | 'poor' | null
    const minScore = url.searchParams.get('minScore')
      ? parseInt(url.searchParams.get('minScore')!, 10)
      : undefined

    const result = await getTopLendingCandidates({
      page: isNaN(page) ? 1 : page,
      pageSize: isNaN(pageSize) ? 20 : pageSize,
      band: band || undefined,
      minScore,
    })

    // Check if cache is empty (signal to admin to run compute)
    const cacheEmpty = result.total === 0 && !result.cacheStaleAt

    return NextResponse.json({
      success: true,
      ...result,
      cacheEmpty,
    })
  } catch (error) {
    console.error('Candidates API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch candidates',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
