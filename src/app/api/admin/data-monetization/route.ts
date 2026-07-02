import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCreditScoreSummary } from '@/lib/credit-score'

/**
 * GET /api/admin/data-monetization
 *
 * Returns credit scoring summary using bulk aggregate queries.
 * Scales to millions of users — NO N+1 queries.
 *
 * For individual user scores, use ?userId=xxx
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const userId = url.searchParams.get('userId')

    // Single user detail
    if (userId) {
      const { computeSingleUserScore } = await import('@/lib/credit-score')
      const score = await computeSingleUserScore(userId)
      if (!score) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      return NextResponse.json({ success: true, score })
    }

    // Summary (uses bulk aggregate or cache)
    const summary = await getCreditScoreSummary()

    const lendingRevenue = {
      excellent: { count: summary.excellent, potentialPerUser: 200, totalPotential: summary.excellent * 200 },
      good: { count: summary.good, potentialPerUser: 150, totalPotential: summary.good * 150 },
      fair: { count: summary.fair, potentialPerUser: 100, totalPotential: summary.fair * 100 },
      poor: { count: summary.poor, potentialPerUser: 0, totalPotential: 0 },
    }

    const totalLendingRevenue = lendingRevenue.excellent.totalPotential +
                                 lendingRevenue.good.totalPotential +
                                 lendingRevenue.fair.totalPotential

    return NextResponse.json({
      success: true,
      summary,
      lendingRevenue,
      totalLendingRevenuePotential: totalLendingRevenue,
      // Top candidates not included in summary — use separate paginated API
      // This keeps the summary page fast (no findMany)
    })
  } catch (error) {
    console.error('Data monetization API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch data',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
