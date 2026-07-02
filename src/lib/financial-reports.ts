/**
 * Financial Reporting Engine — generates P&L, Balance Sheet, Cash Flow.
 *
 * INVESTOR-GRADE FINANCIALS:
 *   1. P&L Statement (Income Statement):
 *      Revenue (recognized) - COGS (AI costs) - Operating Expenses = Net Income
 *
 *   2. Balance Sheet:
 *      Assets (Cash) = Liabilities (Deferred Revenue) + Equity (Retained Earnings)
 *
 *   3. Cash Flow Statement:
 *      Cash from Operations (cash received - cash paid)
 *      + Cash from Investing (0 for SaaS — no capex)
 *      + Cash from Financing (0 — no debt/equity raised)
 *      = Net Change in Cash
 *
 * DATA SOURCES:
 *   - RevenueSchedule (recognized revenue for P&L, deferred for balance sheet)
 *   - AiUsageLog (AI costs — COGS)
 *   - Subscription (cash received — for cash flow)
 *   - Payment gateway fees: estimated at 2% of transaction value (Razorpay standard)
 */

import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface ProfitLossReport {
  period: { start: string; end: string; label: string }
  revenue: {
    subscriptionRevenue: number      // recognized revenue from schedules
    totalRevenue: number
  }
  costs: {
    aiCosts: number                   // Gemini/OpenAI/Groq API costs (COGS)
    paymentGatewayFees: number        // ~2% of cash received (Razorpay)
    totalCOGS: number
    grossProfit: number
    grossMarginPct: number
  }
  operatingExpenses: {
    totalOpex: number                 // estimated (server, database, monitoring)
    operatingIncome: number
  }
  netIncome: number
  netMarginPct: number
}

export interface BalanceSheetReport {
  asOfDate: string
  assets: {
    cash: number                      // cumulative cash received - cumulative cash paid
    accountsReceivable: number        // 0 (we collect upfront)
    totalAssets: number
  }
  liabilities: {
    deferredRevenue: number           // unearned subscription revenue
    accountsPayable: number           // 0 (we pay AI providers upfront)
    totalLiabilities: number
  }
  equity: {
    retainedEarnings: number          // cumulative recognized revenue - cumulative costs
    totalEquity: number
  }
  balanced: boolean                   // assets == liabilities + equity
}

export interface CashFlowReport {
  period: { start: string; end: string; label: string }
  operatingActivities: {
    cashFromSubscriptions: number     // cash received from subscriptions
    cashPaidToAIProviders: number     // AI API costs (negative)
    cashPaidToRazorpay: number        // payment gateway fees (negative)
    netOperatingCash: number
  }
  investingActivities: {
    netInvestingCash: number          // 0 for SaaS (no capex)
  }
  financingActivities: {
    netFinancingCash: number          // 0 (no debt/equity)
  }
  netChangeInCash: number
}

// =====================================================================
// P&L STATEMENT
// =====================================================================

export async function getProfitLoss(year: number, month?: number): Promise<ProfitLossReport> {
  // Determine period
  let periodStart: Date
  let periodEnd: Date
  let label: string

  if (month !== undefined) {
    // Monthly report
    periodStart = new Date(year, month, 1)
    periodEnd = new Date(year, month + 1, 0, 23, 59, 59)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    label = `${monthNames[month]} ${year}`
  } else {
    // Yearly report
    periodStart = new Date(year, 0, 1)
    periodEnd = new Date(year, 11, 31, 23, 59, 59)
    label = `FY ${year}`
  }

  // Parallel queries for revenue + costs
  const [revenueAgg, aiCostAgg, subscriptionCashAgg] = await Promise.all([
    // Recognized revenue in this period
    withTimeout(
      db.revenueSchedule.aggregate({
        where: {
          status: 'recognized',
          periodStart: { gte: periodStart, lte: periodEnd },
        },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // AI costs in this period (COGS)
    withTimeout(
      db.aiUsageLog.aggregate({
        where: { createdAt: { gte: periodStart, lte: periodEnd } },
        _sum: { costInr: true },
      }),
      5000
    ).catch(() => ({ _sum: { costInr: 0 } })),

    // Cash received from subscriptions in this period (for payment gateway fee calc)
    withTimeout(
      db.subscription.aggregate({
        where: { createdAt: { gte: periodStart, lte: periodEnd } },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),
  ])

  const subscriptionRevenue = revenueAgg._sum.amount || 0
  const aiCosts = aiCostAgg._sum.costInr || 0
  const cashReceived = subscriptionCashAgg._sum.amount || 0

  // Payment gateway fees: ~2% of cash received (Razorpay standard domestic rate)
  const paymentGatewayFees = Math.round(cashReceived * 0.02 * 100) / 100

  // COGS = AI costs + payment gateway fees
  const totalCOGS = aiCosts + paymentGatewayFees

  // Gross profit
  const grossProfit = subscriptionRevenue - totalCOGS
  const grossMarginPct = subscriptionRevenue > 0
    ? Math.round((grossProfit / subscriptionRevenue) * 1000) / 10
    : 0

  // Operating expenses (estimated — server, database, monitoring, domains)
  // These are real costs not tracked in DB, so we estimate based on user count
  const userCount = await withTimeout(db.user.count(), 5000).catch(() => 0)
  const totalOpex = estimateOpex(userCount)

  const operatingIncome = grossProfit - totalOpex

  // Net income = operating income (no tax for simplicity — Indian startups < ₹100Cr revenue)
  const netIncome = operatingIncome
  const netMarginPct = subscriptionRevenue > 0
    ? Math.round((netIncome / subscriptionRevenue) * 1000) / 10
    : 0

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label,
    },
    revenue: {
      subscriptionRevenue,
      totalRevenue: subscriptionRevenue,
    },
    costs: {
      aiCosts,
      paymentGatewayFees,
      totalCOGS,
      grossProfit,
      grossMarginPct,
    },
    operatingExpenses: {
      totalOpex,
      operatingIncome,
    },
    netIncome,
    netMarginPct,
  }
}

// =====================================================================
// BALANCE SHEET
// =====================================================================

export async function getBalanceSheet(asOfDate?: Date): Promise<BalanceSheetReport> {
  const date = asOfDate || new Date()

  // Parallel queries
  const [totalCashReceived, totalAICosts, totalGatewayFees, deferredRevenueAgg, totalRecognizedRevenue, totalOpexAllTime] = await Promise.all([
    // Total cash received (all subscriptions)
    withTimeout(
      db.subscription.aggregate({ _sum: { amount: true } }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // Total AI costs (all time)
    withTimeout(
      db.aiUsageLog.aggregate({ _sum: { costInr: true } }),
      5000
    ).catch(() => ({ _sum: { costInr: 0 } })),

    // Total gateway fees (2% of cash received) — computed from cashReceived above
    Promise.resolve(0),

    // Deferred revenue (pending + current schedules)
    withTimeout(
      db.revenueSchedule.aggregate({
        where: { status: { in: ['pending', 'current'] } },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // Total recognized revenue (all time)
    withTimeout(
      db.revenueSchedule.aggregate({
        where: { status: 'recognized' },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // User count for opex estimation
    withTimeout(db.user.count(), 5000).catch(() => 0),
  ])

  const cashReceived = totalCashReceived._sum.amount || 0
  const aiCostsTotal = totalAICosts._sum.costInr || 0
  const gatewayFeesTotal = Math.round(cashReceived * 0.02 * 100) / 100
  const opexTotal = estimateOpex(totalOpexAllTime as number)

  // Assets
  // Cash = cash received - AI costs paid - gateway fees paid - opex paid
  const cash = Math.max(0, cashReceived - aiCostsTotal - gatewayFeesTotal - opexTotal)
  const accountsReceivable = 0 // SaaS collects upfront
  const totalAssets = cash + accountsReceivable

  // Liabilities
  const deferredRevenue = deferredRevenueAgg._sum.amount || 0
  const accountsPayable = 0 // we pay providers upfront
  const totalLiabilities = deferredRevenue + accountsPayable

  // Equity = Retained Earnings = total recognized revenue - total costs
  const totalCosts = aiCostsTotal + gatewayFeesTotal + opexTotal
  const retainedEarnings = (totalRecognizedRevenue._sum.amount || 0) - totalCosts
  const totalEquity = retainedEarnings

  // Check: assets should ≈ liabilities + equity
  const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 100 // ₹100 tolerance

  return {
    asOfDate: date.toISOString(),
    assets: {
      cash,
      accountsReceivable,
      totalAssets,
    },
    liabilities: {
      deferredRevenue,
      accountsPayable,
      totalLiabilities,
    },
    equity: {
      retainedEarnings,
      totalEquity,
    },
    balanced,
  }
}

// =====================================================================
// CASH FLOW STATEMENT
// =====================================================================

export async function getCashFlow(year: number, month?: number): Promise<CashFlowReport> {
  let periodStart: Date
  let periodEnd: Date
  let label: string

  if (month !== undefined) {
    periodStart = new Date(year, month, 1)
    periodEnd = new Date(year, month + 1, 0, 23, 59, 59)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    label = `${monthNames[month]} ${year}`
  } else {
    periodStart = new Date(year, 0, 1)
    periodEnd = new Date(year, 11, 31, 23, 59, 59)
    label = `FY ${year}`
  }

  const [cashFromSubsAgg, aiCostAgg] = await Promise.all([
    // Cash received from subscriptions in period
    withTimeout(
      db.subscription.aggregate({
        where: { createdAt: { gte: periodStart, lte: periodEnd } },
        _sum: { amount: true },
      }),
      5000
    ).catch(() => ({ _sum: { amount: 0 } })),

    // AI costs paid in period
    withTimeout(
      db.aiUsageLog.aggregate({
        where: { createdAt: { gte: periodStart, lte: periodEnd } },
        _sum: { costInr: true },
      }),
      5000
    ).catch(() => ({ _sum: { costInr: 0 } })),
  ])

  const cashFromSubscriptions = cashFromSubsAgg._sum.amount || 0
  const cashPaidToAI = aiCostAgg._sum.costInr || 0
  const cashPaidToRazorpay = Math.round(cashFromSubscriptions * 0.02 * 100) / 100

  const netOperatingCash = cashFromSubscriptions - cashPaidToAI - cashPaidToRazorpay

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label,
    },
    operatingActivities: {
      cashFromSubscriptions,
      cashPaidToAIProviders: cashPaidToAI,
      cashPaidToRazorpay,
      netOperatingCash,
    },
    investingActivities: {
      netInvestingCash: 0, // SaaS — no capital expenditure
    },
    financingActivities: {
      netFinancingCash: 0, // No debt or equity raised
    },
    netChangeInCash: netOperatingCash,
  }
}

// =====================================================================
// HELPER: Estimate Operating Expenses
// =====================================================================
// Real costs not tracked in DB. Estimated based on user count:
//   - Vercel: $20/month (Pro plan)
//   - Neon DB: $0-19/month (free tier or scale)
//   - Domain: ₹1000/year (~₹83/month)
//   - Sentry: $0-26/month
//   - MSG91 SMS: variable (not included here — tracked in notification costs)
//   - Email (Resend): $0-20/month
//
// Scales with users: more users → more serverless function invocations

function estimateOpex(userCount: number): number {
  const baseCost = 5000 // ₹5000/month base (Vercel + DB + domain + monitoring)
  const perUserCost = 0.5 // ₹0.50/user/month (serverless compute scaling)
  return Math.round((baseCost + userCount * perUserCost) * 100) / 100
}
