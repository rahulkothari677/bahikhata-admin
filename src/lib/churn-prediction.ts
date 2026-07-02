/**
 * Predictive Churn Model — identifies users at risk of churning.
 *
 * HOW IT WORKS:
 *   For each user, we compute 6 risk factor scores (0-100 each):
 *     1. Inactivity: days since last login → more days = higher risk
 *     2. Engagement: days since last transaction → more days = higher risk
 *     3. AI Usage Decline: comparing last 7 days vs previous 7 days of AI calls
 *     4. Plan Tier: free users = higher baseline risk than paid
 *     5. Account Age: very new (<7d) or very old (>365d without upgrade) = higher risk
 *     6. Support: users with open support tickets = higher risk
 *
 *   Weighted average → overall risk score (0-100)
 *   Risk levels: 0-25 low, 26-50 medium, 51-75 high, 76-100 critical
 *
 * RECOMMENDATIONS:
 *   - low: no action needed
 *   - medium: monitor, add to observation list
 *   - high: send win-back campaign (SMS/email with tips)
 *   - critical: personal outreach, offer discount
 */

import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface ChurnFactors {
  inactivityScore: number
  engagementScore: number
  aiUsageScore: number
  planScore: number
  ageScore: number
  supportScore: number
}

export interface ChurnResult {
  userId: string
  userName: string | null
  userEmail: string | null
  userPlan: string
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  factors: ChurnFactors
  recommendedAction: string | null
}

export interface ComputeSummary {
  totalUsers: number
  newPredictions: number
  byLevel: { low: number; medium: number; high: number; critical: number }
  durationMs: number
}

// =====================================================================
// WEIGHTS (must sum to 1.0)
// =====================================================================
const WEIGHTS = {
  inactivity: 0.25,   // 25% — most important signal
  engagement: 0.25,   // 25% — second most important
  aiUsage: 0.15,      // 15% — usage decline
  plan: 0.10,         // 10% — free users churn more
  age: 0.10,          // 10% — new/old accounts
  support: 0.15,      // 15% — frustrated users
}

// =====================================================================
// SCORING FUNCTIONS (each returns 0-100)
// =====================================================================

function scoreInactivity(daysSinceLogin: number | null): number {
  if (daysSinceLogin === null) return 80 // never logged in = high risk
  if (daysSinceLogin <= 1) return 0      // active today
  if (daysSinceLogin <= 3) return 10     // active this week
  if (daysSinceLogin <= 7) return 25     // active last week
  if (daysSinceLogin <= 14) return 50    // 2 weeks inactive
  if (daysSinceLogin <= 30) return 75    // 1 month inactive
  return 100                              // >1 month = critical
}

function scoreEngagement(daysSinceTransaction: number | null): number {
  if (daysSinceTransaction === null) return 60 // no transactions = moderate risk (new user?)
  if (daysSinceTransaction <= 1) return 0
  if (daysSinceTransaction <= 3) return 10
  if (daysSinceTransaction <= 7) return 25
  if (daysSinceTransaction <= 14) return 50
  if (daysSinceTransaction <= 30) return 75
  return 100
}

function scoreAIUsage(declinePct: number): number {
  // declinePct: positive = usage declining, negative = usage growing
  if (declinePct <= 0) return 0         // growing = no risk
  if (declinePct <= 25) return 20       // slight decline
  if (declinePct <= 50) return 40       // moderate decline
  if (declinePct <= 75) return 70       // significant decline
  return 100                              // stopped using AI
}

function scorePlan(plan: string): number {
  // Free users have higher baseline churn risk
  if (plan === 'free') return 60
  if (plan === 'pro') return 25
  if (plan === 'elite') return 10        // elite users rarely churn
  return 50
}

function scoreAge(accountAgeDays: number): number {
  if (accountAgeDays <= 7) return 60      // very new — haven't formed habit yet
  if (accountAgeDays <= 30) return 30     // still early
  if (accountAgeDays <= 90) return 10     // settled in
  if (accountAgeDays <= 365) return 15    // established
  return 40                                // >1 year — might be getting bored
}

function scoreSupport(openTicketCount: number): number {
  if (openTicketCount === 0) return 0
  if (openTicketCount === 1) return 30
  if (openTicketCount === 2) return 60
  return 100 // 3+ open tickets = very frustrated
}

// =====================================================================
// COMPUTE RISK LEVEL
// =====================================================================

function getRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 76) return 'critical'
  if (score >= 51) return 'high'
  if (score >= 26) return 'medium'
  return 'low'
}

function getRecommendation(level: string, plan: string): string | null {
  switch (level) {
    case 'critical':
      return plan === 'free'
        ? 'Personal outreach + offer 50% off Pro for 3 months. High churn risk.'
        : 'Personal outreach + offer free month. Account at critical churn risk.'
    case 'high':
      return 'Send win-back campaign (SMS + email with usage tips). Consider discount offer.'
    case 'medium':
      return 'Add to observation list. Monitor for 7 days. Send re-engagement notification.'
    case 'low':
      return null // no action needed
    default:
      return null
  }
}

// =====================================================================
// MAIN COMPUTE FUNCTION
// =====================================================================

export async function computeChurnPredictions(): Promise<ComputeSummary> {
  const startTime = Date.now()
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  // Fetch all users (in chunks to avoid memory issues)
  const CHUNK = 500
  let totalUsers = 0
  let newPredictions = 0
  const byLevel = { low: 0, medium: 0, high: 0, critical: 0 }

  // Get total user count first
  const userCount = await withTimeout(db.user.count(), 5000).catch(() => 0)

  for (let offset = 0; offset < userCount; offset += CHUNK) {
    const users = await withNeonRetry(() =>
      db.user.findMany({
        skip: offset,
        take: CHUNK,
        select: { id: true, email: true, name: true, plan: true, createdAt: true, updatedAt: true },
      })
    ).catch(() => [])

    if (users.length === 0) break

    // Batch fetch data for this chunk
    const userIds = users.map(u => u.id)

    // Last transactions per user
    const lastTxns = await withNeonRetry(() =>
      db.transaction.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _max: { createdAt: true },
      })
    ).catch(() => [])

    // AI usage last 7 days
    const aiLast7d = await withNeonRetry(() =>
      db.aiUsageLog.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, createdAt: { gte: sevenDaysAgo } },
        _count: true,
      })
    ).catch(() => [])

    // AI usage previous 7 days (7-14 days ago)
    const aiPrev7d = await withNeonRetry(() =>
      db.aiUsageLog.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
        _count: true,
      })
    ).catch(() => [])

    // Open support tickets per user
    const openTickets = await withNeonRetry(() =>
      db.supportTicket.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: { in: ['open', 'in_progress'] } },
        _count: true,
      })
    ).catch(() => [])

    // Build lookup maps
    const lastTxnMap = new Map<string, Date>()
    for (const t of lastTxns as any[]) {
      if (t._max.createdAt) lastTxnMap.set(t.userId, t._max.createdAt)
    }

    const aiLast7dMap = new Map<string, number>()
    for (const a of aiLast7d as any[]) aiLast7dMap.set(a.userId, a._count)

    const aiPrev7dMap = new Map<string, number>()
    for (const a of aiPrev7d as any[]) aiPrev7dMap.set(a.userId, a._count)

    const openTicketsMap = new Map<string, number>()
    for (const t of openTickets as any[]) openTicketsMap.set(t.userId, t._count)

    // Compute scores per user
    const predictions: Array<any> = []

    for (const user of users) {
      const daysSinceLogin = user.updatedAt
        ? Math.floor((now.getTime() - user.updatedAt.getTime()) / (24 * 60 * 60 * 1000))
        : null

      const lastTxnDate = lastTxnMap.get(user.id)
      const daysSinceTransaction = lastTxnDate
        ? Math.floor((now.getTime() - lastTxnDate.getTime()) / (24 * 60 * 60 * 1000))
        : null

      const aiLast = aiLast7dMap.get(user.id) || 0
      const aiPrev = aiPrev7dMap.get(user.id) || 0
      const aiDeclinePct = aiPrev > 0 ? ((aiPrev - aiLast) / aiPrev) * 100 : (aiLast > 0 ? 0 : 100)

      const accountAgeDays = Math.floor((now.getTime() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000))
      const ticketCount = openTicketsMap.get(user.id) || 0

      // Compute factor scores
      const factors: ChurnFactors = {
        inactivityScore: scoreInactivity(daysSinceLogin),
        engagementScore: scoreEngagement(daysSinceTransaction),
        aiUsageScore: scoreAIUsage(aiDeclinePct),
        planScore: scorePlan(user.plan),
        ageScore: scoreAge(accountAgeDays),
        supportScore: scoreSupport(ticketCount),
      }

      // Weighted average
      const riskScore = Math.round(
        factors.inactivityScore * WEIGHTS.inactivity +
        factors.engagementScore * WEIGHTS.engagement +
        factors.aiUsageScore * WEIGHTS.aiUsage +
        factors.planScore * WEIGHTS.plan +
        factors.ageScore * WEIGHTS.age +
        factors.supportScore * WEIGHTS.support
      )

      const riskLevel = getRiskLevel(riskScore)
      const recommendedAction = getRecommendation(riskLevel, user.plan)

      predictions.push({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userPlan: user.plan,
        riskScore: Math.min(100, Math.max(0, riskScore)),
        riskLevel,
        ...factors,
        recommendedAction,
      })

      byLevel[riskLevel]++
    }

    // Upsert to DB (delete old + create new for this chunk)
    if (predictions.length > 0) {
      await db.churnPrediction.deleteMany({
        where: { userId: { in: userIds } },
      })

      await db.churnPrediction.createMany({
        data: predictions,
        skipDuplicates: true,
      })

      newPredictions += predictions.length
    }

    totalUsers += users.length
  }

  return {
    totalUsers,
    newPredictions,
    byLevel,
    durationMs: Date.now() - startTime,
  }
}
