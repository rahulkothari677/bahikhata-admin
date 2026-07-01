import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeAllCreditScores, computeCreditScore } from '@/lib/credit-score'

/**
 * GET /api/admin/data-monetization
 *
 * Returns data monetization analytics:
 *   1. Credit scores for all users (lending pipeline)
 *   2. Lending lead marketplace (users by credit band)
 *   3. Revenue potential (commission estimates)
 *   4. GST filing opportunities
 *   5. Supplier intelligence potential
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const userId = url.searchParams.get('userId')

    // If userId provided, return single user's credit score
    if (userId) {
      const score = await computeCreditScore(userId)
      if (!score) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      return NextResponse.json({ success: true, score })
    }

    // Otherwise compute all credit scores
    const allScores = await computeAllCreditScores()

    // Group by band
    const byBand = {
      excellent: allScores.filter(s => s.band === 'excellent'),
      good: allScores.filter(s => s.band === 'good'),
      fair: allScores.filter(s => s.band === 'fair'),
      poor: allScores.filter(s => s.band === 'poor'),
    }

    // Calculate lending revenue potential
    const lendingRevenue = {
      excellent: {
        count: byBand.excellent.length,
        avgLoanAmount: 200000,
        commissionRate: 0.02,
        potentialPerUser: 200,
        totalPotential: byBand.excellent.length * 200,
        totalLoanDisbursalPotential: byBand.excellent.length * 200000 * 0.02,
      },
      good: {
        count: byBand.good.length,
        avgLoanAmount: 100000,
        commissionRate: 0.02,
        potentialPerUser: 150,
        totalPotential: byBand.good.length * 150,
        totalLoanDisbursalPotential: byBand.good.length * 100000 * 0.02,
      },
      fair: {
        count: byBand.fair.length,
        avgLoanAmount: 50000,
        commissionRate: 0.025,
        potentialPerUser: 100,
        totalPotential: byBand.fair.length * 100,
        totalLoanDisbursalPotential: byBand.fair.length * 50000 * 0.025,
      },
      poor: {
        count: byBand.poor.length,
        avgLoanAmount: 0,
        potentialPerUser: 0,
        totalPotential: 0,
        totalLoanDisbursalPotential: 0,
      },
    }

    const totalLendingRevenue = lendingRevenue.excellent.totalPotential +
                                 lendingRevenue.good.totalPotential +
                                 lendingRevenue.fair.totalPotential

    const totalLoanCommission = lendingRevenue.excellent.totalLoanDisbursalPotential +
                                 lendingRevenue.good.totalLoanDisbursalPotential +
                                 lendingRevenue.fair.totalLoanDisbursalPotential

    return NextResponse.json({
      success: true,
      summary: {
        totalScoredUsers: allScores.length,
        excellentCount: byBand.excellent.length,
        goodCount: byBand.good.length,
        fairCount: byBand.fair.length,
        poorCount: byBand.poor.length,
        avgScore: allScores.length > 0
          ? Math.round(allScores.reduce((s, u) => s + u.totalScore, 0) / allScores.length)
          : 0,
      },
      lendingRevenue,
      totalLendingRevenuePotential: totalLendingRevenue,
      totalLoanCommissionPotential: totalLoanCommission,
      topCandidates: allScores.slice(0, 20),
      allScores: allScores.map(s => ({
        userId: s.userId,
        userEmail: s.userEmail,
        userName: s.userName,
        score: s.totalScore,
        band: s.band,
        avgMonthlySales: s.metrics.avgMonthlySales,
        recommendation: s.recommendation,
      })),
    })
  } catch (error) {
    console.error('Data monetization API error:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
