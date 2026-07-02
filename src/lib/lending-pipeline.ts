/**
 * Lending Pipeline — delivers credit-scored leads to NBFC partners via webhooks.
 *
 * HOW IT WORKS:
 *   1. Fetch top lending candidates from CreditScoreCache (sorted by score DESC)
 *   2. For each candidate, check which NBFC partners have active webhooks
 *      subscribed to 'lead.created' event
 *   3. Dispatch webhook event with lead data (score, band, monthly sales, etc.)
 *   4. Webhook delivery engine sends to partner + retries on failure
 *   5. Partner receives lead, decides to lend or reject, updates via API
 *
 * REVENUE MODEL:
 *   - Excellent band (750+): ₹200 per lead
 *   - Good band (650-749): ₹150 per lead
 *   - Fair band (550-649): ₹100 per lead
 *   - Poor band (<550): not delivered (not eligible for lending)
 *
 * PRIVACY:
 *   - User data shared ONLY with partners who have explicit data-sharing agreement
 *   - Partner status must be 'active'
 *   - DPDP compliance: user consent required (future: consent flag on User model)
 */

import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { dispatchEvent } from '@/lib/webhook-engine'

export interface LeadDeliveryResult {
  totalCandidates: number
  eligibleLeads: number
  delivered: number
  skipped: number
  revenue: number
  durationMs: number
}

const REVENUE_PER_LEAD: Record<string, number> = {
  excellent: 200,
  good: 150,
  fair: 100,
  poor: 0,
}

export async function deliverLeadsToPartners(opts: {
  minScore?: number
  maxLeads?: number
  band?: string
}): Promise<LeadDeliveryResult> {
  const startTime = Date.now()
  const minScore = opts.minScore || 550 // default: only fair+ (exclude poor)
  const maxLeads = opts.maxLeads || 100

  // 1. Fetch eligible candidates from CreditScoreCache
  const candidates = await withNeonRetry(() =>
    db.creditScoreCache.findMany({
      where: {
        score: { gte: minScore },
        ...(opts.band ? { band: opts.band } : {}),
      },
      orderBy: { score: 'desc' },
      take: maxLeads,
    })
  ).catch(() => [])

  if (candidates.length === 0) {
    return { totalCandidates: 0, eligibleLeads: 0, delivered: 0, skipped: 0, revenue: 0, durationMs: Date.now() - startTime }
  }

  // 2. Dispatch 'lead.created' webhook event for all eligible leads
  // The webhook engine will find all active endpoints subscribed to 'lead.created'
  // and create WebhookDelivery records for each.
  const leadPayload = {
    leads: candidates.map((c: any) => ({
      userId: c.userId,
      creditScore: c.score,
      band: c.band,
      avgMonthlySales: c.avgMonthlySales,
      collectionRate: c.collectionRate,
      businessAgeDays: c.businessAgeDays,
      productCount: c.productCount,
      partyCount: c.partyCount,
      recommendedLoanAmount: getRecommendedLoanAmount(c.band, c.avgMonthlySales),
    })),
    totalLeads: candidates.length,
    generatedAt: new Date().toISOString(),
  }

  const dispatchResult = await dispatchEvent('lead.created', leadPayload).catch(() => ({
    endpointsNotified: 0,
    deliveryIds: [],
  }))

  // 3. Calculate revenue
  let revenue = 0
  for (const c of candidates as any[]) {
    revenue += REVENUE_PER_LEAD[c.band] || 0
  }

  return {
    totalCandidates: candidates.length,
    eligibleLeads: candidates.length,
    delivered: dispatchResult.endpointsNotified,
    skipped: candidates.length - dispatchResult.endpointsNotified,
    revenue,
    durationMs: Date.now() - startTime,
  }
}

function getRecommendedLoanAmount(band: string, monthlySales: number): number {
  const multiplier = band === 'excellent' ? 5 : band === 'good' ? 3 : 1.5
  return Math.round(monthlySales * multiplier)
}

export async function getLendingPipelineOverview() {
  const [excellentCount, goodCount, fairCount, poorCount, totalDelivered, totalRevenue, activeNbfcPartners] = await Promise.all([
    withTimeout(db.creditScoreCache.count({ where: { band: 'excellent' } }), 5000).catch(() => 0),
    withTimeout(db.creditScoreCache.count({ where: { band: 'good' } }), 5000).catch(() => 0),
    withTimeout(db.creditScoreCache.count({ where: { band: 'fair' } }), 5000).catch(() => 0),
    withTimeout(db.creditScoreCache.count({ where: { band: 'poor' } }), 5000).catch(() => 0),
    // Count lead.created deliveries
    withTimeout(
      db.webhookDelivery.count({ where: { eventType: 'lead.created', status: 'success' } }),
      5000
    ).catch(() => 0),
    // Calculate potential revenue (if all eligible leads delivered)
    withTimeout(
      db.creditScoreCache.aggregate({
        where: { score: { gte: 550 } },
        _count: true,
      }),
      5000
    ).catch(() => ({ _count: 0 })),
    // Count active NBFC partners
    withTimeout(
      db.partner.count({ where: { type: 'nbfc', status: 'active' } }),
      5000
    ).catch(() => 0),
  ])

  const eligibleCount = excellentCount + goodCount + fairCount
  const potentialRevenue = excellentCount * 200 + goodCount * 150 + fairCount * 100

  return {
    excellentCount,
    goodCount,
    fairCount,
    poorCount,
    eligibleCount,
    potentialRevenue,
    totalDelivered,
    activeNbfcPartners,
  }
}
