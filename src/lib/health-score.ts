import { db } from '@/lib/db'

/**
 * Customer Health Score — auto-scores each user's health (0-100).
 *
 * Score breakdown:
 *   1. Recency (30 pts) — days since last activity
 *   2. Frequency (25 pts) — transactions in last 30 days
 *   3. AI Engagement (15 pts) — AI calls in last 30 days
 *   4. Plan Value (15 pts) — paid vs free
 *   5. Account Age (15 pts) — how long they've been with us
 *
 * Health bands:
 *   80-100: Excellent (power user, highly engaged)
 *   60-79:  Good (active, healthy)
 *   40-59:  At Risk (declining engagement)
 *   0-39:   Critical (likely to churn)
 */

export interface HealthScore {
  score: number
  band: 'excellent' | 'good' | 'at_risk' | 'critical'
  color: string
  label: string
  breakdown: {
    recency: { score: number; max: number; detail: string }
    frequency: { score: number; max: number; detail: string }
    aiEngagement: { score: number; max: number; detail: string }
    planValue: { score: number; max: number; detail: string }
    accountAge: { score: number; max: number; detail: string }
  }
}

export async function computeHealthScore(userId: string): Promise<HealthScore> {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, plan: true, createdAt: true, updatedAt: true,
      _count: {
        select: {
          transactions: { where: { createdAt: { gte: thirtyDaysAgo } } },
          aiUsageLogs: { where: { createdAt: { gte: thirtyDaysAgo } } },
        },
      },
    },
  })

  if (!user) {
    return { score: 0, band: 'critical', color: 'text-red-600', label: 'Unknown', breakdown: {} as any }
  }

  // 1. RECENCY (30 pts)
  const daysSinceActive = Math.floor((now.getTime() - user.updatedAt.getTime()) / (24 * 60 * 60 * 1000))
  let recencyScore = 0
  let recencyDetail = ''
  if (daysSinceActive <= 1) { recencyScore = 30; recencyDetail = 'Active today' }
  else if (daysSinceActive <= 3) { recencyScore = 25; recencyDetail = `${daysSinceActive}d ago` }
  else if (daysSinceActive <= 7) { recencyScore = 18; recencyDetail = `${daysSinceActive}d ago` }
  else if (daysSinceActive <= 14) { recencyScore = 10; recencyDetail = `${daysSinceActive}d ago` }
  else if (daysSinceActive <= 30) { recencyScore = 5; recencyDetail = `${daysSinceActive}d ago` }
  else { recencyScore = 0; recencyDetail = `${daysSinceActive}d ago (inactive)` }

  // 2. FREQUENCY (25 pts)
  const txCount = user._count.transactions
  let freqScore = 0
  let freqDetail = ''
  if (txCount >= 50) { freqScore = 25; freqDetail = `${txCount} txns (power user)` }
  else if (txCount >= 20) { freqScore = 20; freqDetail = `${txCount} txns (active)` }
  else if (txCount >= 10) { freqScore = 15; freqDetail = `${txCount} txns (regular)` }
  else if (txCount >= 5) { freqScore = 10; freqDetail = `${txCount} txns (light)` }
  else if (txCount >= 1) { freqScore = 5; freqDetail = `${txCount} txn(s)` }
  else { freqScore = 0; freqDetail = 'No transactions' }

  // 3. AI ENGAGEMENT (15 pts)
  const aiCount = user._count.aiUsageLogs
  let aiScore = 0
  let aiDetail = ''
  if (aiCount >= 50) { aiScore = 15; aiDetail = `${aiCount} AI calls (heavy)` }
  else if (aiCount >= 20) { aiScore = 12; aiDetail = `${aiCount} AI calls` }
  else if (aiCount >= 5) { aiScore = 8; aiDetail = `${aiCount} AI calls` }
  else if (aiCount >= 1) { aiScore = 4; aiDetail = `${aiCount} AI call(s)` }
  else { aiScore = 0; aiDetail = 'No AI usage' }

  // 4. PLAN VALUE (15 pts)
  let planScore = 0
  let planDetail = ''
  if (user.plan === 'elite') { planScore = 15; planDetail = 'Elite (₹599/mo)' }
  else if (user.plan === 'pro') { planScore = 10; planDetail = 'Pro (₹299/mo)' }
  else { planScore = 3; planDetail = 'Free plan' }

  // 5. ACCOUNT AGE (15 pts)
  const ageDays = Math.floor((now.getTime() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000))
  let ageScore = 0
  let ageDetail = ''
  if (ageDays >= 90) { ageScore = 15; ageDetail = `${Math.floor(ageDays / 30)} months` }
  else if (ageDays >= 30) { ageScore = 10; ageDetail = `${Math.floor(ageDays / 7)} weeks` }
  else if (ageDays >= 7) { ageScore = 5; ageDetail = `${ageDays} days` }
  else { ageScore = 2; ageDetail = `${ageDays} days (new)` }

  const total = recencyScore + freqScore + aiScore + planScore + ageScore
  const band = total >= 80 ? 'excellent' : total >= 60 ? 'good' : total >= 40 ? 'at_risk' : 'critical'
  const color = band === 'excellent' ? 'text-emerald-600' :
                band === 'good' ? 'text-blue-600' :
                band === 'at_risk' ? 'text-amber-600' : 'text-red-600'
  const label = band === 'excellent' ? 'Excellent' :
                band === 'good' ? 'Good' :
                band === 'at_risk' ? 'At Risk' : 'Critical'

  return {
    score: total,
    band,
    color,
    label,
    breakdown: {
      recency: { score: recencyScore, max: 30, detail: recencyDetail },
      frequency: { score: freqScore, max: 25, detail: freqDetail },
      aiEngagement: { score: aiScore, max: 15, detail: aiDetail },
      planValue: { score: planScore, max: 15, detail: planDetail },
      accountAge: { score: ageScore, max: 15, detail: ageDetail },
    },
  }
}
