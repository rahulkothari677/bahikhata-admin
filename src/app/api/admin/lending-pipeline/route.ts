import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { getLendingPipelineOverview } from '@/lib/lending-pipeline'

/**
 * GET /api/admin/lending-pipeline
 * Query: ?tab=overview|leads
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'

    if (tab === 'overview') {
      const overview = await getLendingPipelineOverview()

      // Also fetch recent lead deliveries
      const recentDeliveries = await withNeonRetry(() =>
        db.webhookDelivery.findMany({
          where: { eventType: 'lead.created' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            endpoint: { select: { url: true, partner: { select: { name: true } } } },
          },
        })
      ).catch(() => [])

      return NextResponse.json({
        success: true,
        overview,
        recentDeliveries: (recentDeliveries as any[]).map((d: any) => ({
          id: d.id,
          status: d.status,
          attemptCount: d.attemptCount,
          responseStatus: d.responseStatus,
          errorMessage: d.errorMessage,
          partnerName: d.endpoint?.partner?.name || 'Unknown',
          endpointUrl: d.endpoint?.url || '',
          createdAt: d.createdAt.toISOString(),
          deliveredAt: d.deliveredAt?.toISOString() || null,
        })),
      })
    }

    // Leads tab — top lending candidates
    const leads = await withNeonRetry(() =>
      db.creditScoreCache.findMany({
        where: { score: { gte: 550 } },
        orderBy: { score: 'desc' },
        take: 50,
        select: {
          id: true,
          userId: true,
          score: true,
          band: true,
          avgMonthlySales: true,
          collectionRate: true,
          businessAgeDays: true,
          productCount: true,
          partyCount: true,
          recommendation: true,
          computedAt: true,
        },
      })
    ).catch(() => [])

    return NextResponse.json({
      success: true,
      leads: (leads as any[]).map((l: any) => ({
        ...l,
        recommendedLoanAmount: l.band === 'excellent' ? Math.round(l.avgMonthlySales * 5) :
                               l.band === 'good' ? Math.round(l.avgMonthlySales * 3) :
                               Math.round(l.avgMonthlySales * 1.5),
        revenuePerLead: l.band === 'excellent' ? 200 : l.band === 'good' ? 150 : 100,
        computedAt: l.computedAt.toISOString(),
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch pipeline' }, { status: 500 })
  }
}
