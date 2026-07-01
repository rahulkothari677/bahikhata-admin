import { db } from '@/lib/db'

/**
 * Credit Scoring Algorithm for MSME Shop Owners
 *
 * Computes a credit score (300-900, CIBIL-style) from transaction data.
 * This score helps NBFCs and banks assess lending risk for shop owners
 * who have no formal credit history.
 *
 * Score breakdown (900 total):
 *   1. Transaction Volume (200 pts) — total sales volume over 6 months
 *   2. Transaction Consistency (200 pts) — how regular the sales are
 *   3. Payment Collection Rate (150 pts) — % of sales collected vs credit
 *   4. Business Age (100 pts) — how long the shop has been active
 *   5. Product Diversity (100 pts) — variety of products sold
 *   6. Party (Customer) Base (75 pts) — number of repeat customers
 *   7. GST Compliance (75 pts) — proper GST tracking
 *
 * Score bands:
 *   750-900: Excellent (low risk, prime lending)
 *   650-749: Good (medium risk, standard lending)
 *   550-649: Fair (higher risk, subprime lending)
 *   300-549: Poor (high risk, likely reject)
 */

export interface CreditScore {
  userId: string
  userEmail: string
  userName: string
  totalScore: number
  band: 'excellent' | 'good' | 'fair' | 'poor'
  breakdown: {
    transactionVolume: { score: number; max: number; detail: string }
    consistency: { score: number; max: number; detail: string }
    collectionRate: { score: number; max: number; detail: string }
    businessAge: { score: number; max: number; detail: string }
    productDiversity: { score: number; max: number; detail: string }
    partyBase: { score: number; max: number; detail: string }
    gstCompliance: { score: number; max: number; detail: string }
  }
  metrics: {
    totalSales6Months: number
    avgMonthlySales: number
    activeMonths: number
    collectionRate: number
    businessAgeDays: number
    productCount: number
    partyCount: number
    hasGstData: boolean
  }
  recommendation: string
}

export async function computeCreditScore(userId: string): Promise<CreditScore | null> {
  const now = new Date()
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

  // Fetch all data needed for scoring
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, createdAt: true,
      shops: { select: { gstin: true, state: true } },
    },
  })

  if (!user) return null

  const [transactions6Months, allTransactions, products, parties] = await Promise.all([
    db.transaction.findMany({
      where: { userId, type: 'sale', date: { gte: sixMonthsAgo } },
      select: { totalAmount: true, paidAmount: true, paymentMode: true, date: true, cgst: true, sgst: true, igst: true },
    }),
    db.transaction.findMany({
      where: { userId, type: 'sale' },
      select: { totalAmount: true, date: true },
    }),
    db.product.count({ where: { userId } }),
    db.party.count({ where: { userId } }),
  ])

  // ===== METRICS =====
  const totalSales6Months = transactions6Months.reduce((s, t) => s + t.totalAmount, 0)
  const avgMonthlySales = totalSales6Months / 6
  const businessAgeDays = Math.floor((now.getTime() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000))

  // Active months (months with at least 1 sale in last 6 months)
  const activeMonthsSet = new Set<string>()
  transactions6Months.forEach(t => {
    const monthKey = `${t.date.getFullYear()}-${t.date.getMonth()}`
    activeMonthsSet.add(monthKey)
  })
  const activeMonths = activeMonthsSet.size

  // Collection rate = paidAmount / totalAmount
  const totalPaid = transactions6Months.reduce((s, t) => s + t.paidAmount, 0)
  const collectionRate = totalSales6Months > 0 ? totalPaid / totalSales6Months : 0

  // GST compliance — has any GST data?
  const hasGstData = transactions6Months.some(t => t.cgst > 0 || t.sgst > 0 || t.igst > 0) ||
                     user.shops.some(s => !!s.gstin)

  // ===== SCORING =====

  // 1. Transaction Volume (200 pts)
  // ₹2L+/month = 200, ₹1L = 150, ₹50K = 100, ₹10K = 50, <₹10K = 25
  let volScore = 25
  let volDetail = `< ₹10K/month`
  if (avgMonthlySales >= 200000) { volScore = 200; volDetail = `₹2L+/month (excellent)` }
  else if (avgMonthlySales >= 100000) { volScore = 150; volDetail = `₹1L+/month (good)` }
  else if (avgMonthlySales >= 50000) { volScore = 100; volDetail = `₹50K+/month (fair)` }
  else if (avgMonthlySales >= 10000) { volScore = 50; volDetail = `₹10K+/month (limited)` }

  // 2. Transaction Consistency (200 pts)
  // 6/6 active months = 200, 5 = 170, 4 = 140, 3 = 100, 2 = 60, 1 = 30
  const consistencyScore = [0, 30, 60, 100, 140, 170, 200][activeMonths] || 0
  const consistencyDetail = `${activeMonths}/6 months active`

  // 3. Payment Collection Rate (150 pts)
  // 95%+ = 150, 85% = 120, 70% = 90, 50% = 60, <50% = 30
  let collScore = 30
  let collDetail = `${(collectionRate * 100).toFixed(0)}% collected (poor)`
  if (collectionRate >= 0.95) { collScore = 150; collDetail = `${(collectionRate * 100).toFixed(0)}% collected (excellent)` }
  else if (collectionRate >= 0.85) { collScore = 120; collDetail = `${(collectionRate * 100).toFixed(0)}% collected (good)` }
  else if (collectionRate >= 0.70) { collScore = 90; collDetail = `${(collectionRate * 100).toFixed(0)}% collected (fair)` }
  else if (collectionRate >= 0.50) { collScore = 60; collDetail = `${(collectionRate * 100).toFixed(0)}% collected (poor)` }

  // 4. Business Age (100 pts)
  // 365+ days = 100, 180 = 75, 90 = 50, 30 = 25, <30 = 10
  let ageScore = 10
  let ageDetail = `${businessAgeDays} days (new)`
  if (businessAgeDays >= 365) { ageScore = 100; ageDetail = `${Math.floor(businessAgeDays / 365)} year(s) (established)` }
  else if (businessAgeDays >= 180) { ageScore = 75; ageDetail = `${businessAgeDays} days (growing)` }
  else if (businessAgeDays >= 90) { ageScore = 50; ageDetail = `${businessAgeDays} days (early)` }
  else if (businessAgeDays >= 30) { ageScore = 25; ageDetail = `${businessAgeDays} days (new)` }

  // 5. Product Diversity (100 pts)
  // 50+ products = 100, 20 = 75, 10 = 50, 5 = 30, <5 = 15
  let prodScore = 15
  let prodDetail = `${products} products (limited)`
  if (products >= 50) { prodScore = 100; prodDetail = `${products} products (excellent diversity)` }
  else if (products >= 20) { prodScore = 75; prodDetail = `${products} products (good)` }
  else if (products >= 10) { prodScore = 50; prodDetail = `${products} products (fair)` }
  else if (products >= 5) { prodScore = 30; prodDetail = `${products} products (limited)` }

  // 6. Party (Customer) Base (75 pts)
  // 50+ = 75, 20 = 60, 10 = 40, 5 = 25, <5 = 10
  let partyScore = 10
  let partyDetail = `${parties} parties (very limited)`
  if (parties >= 50) { partyScore = 75; partyDetail = `${parties} parties (strong base)` }
  else if (parties >= 20) { partyScore = 60; partyDetail = `${parties} parties (good)` }
  else if (parties >= 10) { partyScore = 40; partyDetail = `${parties} parties (fair)` }
  else if (parties >= 5) { partyScore = 25; partyDetail = `${parties} parties (limited)` }

  // 7. GST Compliance (75 pts)
  const gstScore = hasGstData ? 75 : 0
  const gstDetail = hasGstData ? 'GST data detected (compliant)' : 'No GST data (non-compliant)'

  // ===== TOTAL =====
  // Base 300 + scored components (700 max) = 300-1000 range, cap at 900
  const finalScore = Math.min(900, Math.max(300, 300 + volScore + consistencyScore + collScore + ageScore + prodScore + partyScore + gstScore))

  const band = finalScore >= 750 ? 'excellent' : finalScore >= 650 ? 'good' : finalScore >= 550 ? 'fair' : 'poor'

  const recommendation =
    band === 'excellent' ? 'Prime lending candidate. Recommend to NBFCs for unsecured loans up to ₹5L.' :
    band === 'good' ? 'Good lending candidate. Recommend for secured loans up to ₹3L.' :
    band === 'fair' ? 'Subprime candidate. Recommend for small ticket loans (₹50K-1L) with collateral.' :
    'High risk. Insufficient data or poor metrics. Do not recommend for lending.'

  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name || user.email,
    totalScore: finalScore,
    band,
    breakdown: {
      transactionVolume: { score: volScore, max: 200, detail: volDetail },
      consistency: { score: consistencyScore, max: 200, detail: consistencyDetail },
      collectionRate: { score: collScore, max: 150, detail: collDetail },
      businessAge: { score: ageScore, max: 100, detail: ageDetail },
      productDiversity: { score: prodScore, max: 100, detail: prodDetail },
      partyBase: { score: partyScore, max: 75, detail: partyDetail },
      gstCompliance: { score: gstScore, max: 75, detail: gstDetail },
    },
    metrics: {
      totalSales6Months,
      avgMonthlySales,
      activeMonths,
      collectionRate,
      businessAgeDays,
      productCount: products,
      partyCount: parties,
      hasGstData,
    },
    recommendation,
  }
}

/**
 * Computes credit scores for ALL users with sufficient data.
 * Used by the admin dashboard to show the full lending pipeline.
 */
export async function computeAllCreditScores(): Promise<CreditScore[]> {
  // Get all users who have at least 1 transaction
  const usersWithTransactions = await db.user.findMany({
    where: { transactions: { some: {} } },
    select: { id: true },
  })

  const scores: CreditScore[] = []
  for (const user of usersWithTransactions) {
    const score = await computeCreditScore(user.id)
    if (score) scores.push(score)
  }

  // Sort by score descending (best candidates first)
  return scores.sort((a, b) => b.totalScore - a.totalScore)
}
