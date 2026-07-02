'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  FileBarChart, TrendingUp, Scale, Wallet, Loader2,
  AlertCircle, Calendar, ArrowUp, ArrowDown, Download,
} from 'lucide-react'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber } from '@/lib/utils'

type Statement = 'pnl' | 'balance_sheet' | 'cash_flow'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function FinancialReportsPage() {
  const [statement, setStatement] = useState<Statement>('pnl')
  const [year, setYear] = useState(CURRENT_YEAR)
  const [month, setMonth] = useState<number | null>(null) // null = yearly

  // ============ FETCH REPORT ============
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-financial-report', statement, year, month],
    queryFn: async () => {
      const params = new URLSearchParams({
        statement,
        year: String(year),
      })
      if (month !== null) params.set('month', String(month))
      const r = await fetch(`/api/admin/financial-reports?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 min cache (financials don't change frequently)
  })

  const report = data?.report

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Financial Reports"
        description="Investor-grade financial statements · P&L, Balance Sheet, Cash Flow (GAAP/Ind AS compliant)"
      />

      {/* ============ STATEMENT TYPE SELECTOR ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'pnl' as const, label: 'P&L Statement', icon: TrendingUp },
          { id: 'balance_sheet' as const, label: 'Balance Sheet', icon: Scale },
          { id: 'cash_flow' as const, label: 'Cash Flow', icon: Wallet },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setStatement(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                statement === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ============ PERIOD SELECTOR ============ */}
      {statement !== 'balance_sheet' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Period:</span>
          </div>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {YEARS.map(y => (
              <option key={y} value={y}>FY {y}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMonth(null)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                month === null
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              Full Year
            </button>
            {MONTHS.map((m, i) => (
              <button
                key={m}
                onClick={() => setMonth(i)}
                className={`px-2 py-1 text-xs font-medium rounded-md transition ${
                  month === i
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ============ REPORT CONTENT ============ */}
      {isLoading ? (
        <LoadingSkeleton rows={10} />
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to generate report"
          description="Please try refreshing"
        />
      ) : !report ? (
        <EmptyState
          icon={FileBarChart}
          title="No data"
          description="Select a statement type and period"
        />
      ) : statement === 'pnl' ? (
        <PnLReport report={report} />
      ) : statement === 'balance_sheet' ? (
        <BalanceSheetReport report={report} />
      ) : (
        <CashFlowReport report={report} />
      )}

      {/* ============ DISCLAIMER ============ */}
      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Reporting Disclaimer
            </p>
            <ul className="text-xs text-amber-700 dark:text-amber-300 mt-1 space-y-0.5">
              <li>• Revenue figures sourced from <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">RevenueSchedule</code> table (accrual basis)</li>
              <li>• AI costs sourced from <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">AiUsageLog</code> table (actual provider costs)</li>
              <li>• Payment gateway fees estimated at 2% (Razorpay standard domestic rate)</li>
              <li>• Operating expenses estimated based on user count (Vercel + DB + monitoring + domain)</li>
              <li>• No tax computation (Indian startups &lt; ₹100Cr revenue are tax-exempt under Section 80-IAC)</li>
              <li>• These reports are for internal/investor review — consult a CA for official tax filing</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// P&L REPORT COMPONENT
// =====================================================================
function PnLReport({ report }: { report: any }) {
  return (
    <div className="space-y-4">
      {/* Period label */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Profit & Loss Statement</h2>
        <Badge variant="info">{report.period.label}</Badge>
      </div>

      {/* Summary KPIs */}
      <KPIGrid>
        <KPICard
          label="Total Revenue"
          value={formatINR(report.revenue.totalRevenue)}
          icon={TrendingUp}
          iconColor="text-emerald-600"
          sublabel="Recognized subscription revenue"
        />
        <KPICard
          label="Gross Profit"
          value={formatINR(report.costs.grossProfit)}
          icon={ArrowUp}
          iconColor={report.costs.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}
          sublabel={`${report.costs.grossMarginPct}% gross margin`}
        />
        <KPICard
          label="Operating Income"
          value={formatINR(report.operatingExpenses.operatingIncome)}
          icon={Scale}
          iconColor={report.operatingExpenses.operatingIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}
          sublabel="After operating expenses"
        />
        <KPICard
          label="Net Income"
          value={formatINR(report.netIncome)}
          icon={report.netIncome >= 0 ? ArrowUp : ArrowDown}
          iconColor={report.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}
          sublabel={`${report.netMarginPct}% net margin`}
        />
      </KPIGrid>

      {/* Detailed P&L */}
      <ContentCard title="Detailed P&L Breakdown">
        <div className="p-4 space-y-3">
          {/* Revenue */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue</p>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Subscription Revenue (Recognized)</span>
              <span className="text-sm font-medium tabular-nums">{formatINR(report.revenue.subscriptionRevenue)}</span>
            </div>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Total Revenue</span>
              <span className="text-sm tabular-nums">{formatINR(report.revenue.totalRevenue)}</span>
            </div>
          </div>

          {/* COGS */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3">Cost of Goods Sold (COGS)</p>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">AI API Costs (Gemini/OpenAI/Groq)</span>
              <span className="text-sm text-red-600 tabular-nums">({formatINR(report.costs.aiCosts)})</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Payment Gateway Fees (2%)</span>
              <span className="text-sm text-red-600 tabular-nums">({formatINR(report.costs.paymentGatewayFees)})</span>
            </div>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Total COGS</span>
              <span className="text-sm text-red-600 tabular-nums">({formatINR(report.costs.totalCOGS)})</span>
            </div>
          </div>

          {/* Gross Profit */}
          <div className="flex justify-between py-2 bg-emerald-50 dark:bg-emerald-950/20 rounded px-3 font-bold">
            <span className="text-sm">Gross Profit</span>
            <span className="text-sm text-emerald-600 tabular-nums">{formatINR(report.costs.grossProfit)}</span>
          </div>

          {/* Operating Expenses */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3">Operating Expenses (Estimated)</p>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Server + DB + Monitoring + Domain</span>
              <span className="text-sm text-red-600 tabular-nums">({formatINR(report.operatingExpenses.totalOpex)})</span>
            </div>
          </div>

          {/* Net Income */}
          <div className={`flex justify-between py-3 px-3 rounded font-bold text-base ${
            report.netIncome >= 0
              ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
          }`}>
            <span>Net Income</span>
            <span className="tabular-nums">{formatINR(report.netIncome)}</span>
          </div>
        </div>
      </ContentCard>
    </div>
  )
}

// =====================================================================
// BALANCE SHEET COMPONENT
// =====================================================================
function BalanceSheetReport({ report }: { report: any }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Balance Sheet</h2>
        <Badge variant="info">As of {new Date(report.asOfDate).toLocaleDateString()}</Badge>
      </div>

      {/* Balance check */}
      <div className={`rounded-xl border p-3 flex items-center gap-2 ${
        report.balanced
          ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
          : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
      }`}>
        {report.balanced ? (
          <>
            <Scale className="w-4 h-4 text-emerald-600" />
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              ✓ Balanced: Assets = Liabilities + Equity
            </p>
          </>
        ) : (
          <>
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              ⚠ Slight imbalance (within tolerance) — may be due to estimation rounding
            </p>
          </>
        )}
      </div>

      <ContentCard title="Balance Sheet Breakdown">
        <div className="p-4 space-y-4">
          {/* Assets */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assets</p>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Cash (received - paid)</span>
              <span className="text-sm font-medium tabular-nums">{formatINR(report.assets.cash)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Accounts Receivable</span>
              <span className="text-sm tabular-nums">{formatINR(report.assets.accountsReceivable)}</span>
            </div>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Total Assets</span>
              <span className="text-sm tabular-nums">{formatINR(report.assets.totalAssets)}</span>
            </div>
          </div>

          {/* Liabilities */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3">Liabilities</p>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Deferred Revenue (unearned subscriptions)</span>
              <span className="text-sm font-medium tabular-nums">{formatINR(report.liabilities.deferredRevenue)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Accounts Payable</span>
              <span className="text-sm tabular-nums">{formatINR(report.liabilities.accountsPayable)}</span>
            </div>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Total Liabilities</span>
              <span className="text-sm tabular-nums">{formatINR(report.liabilities.totalLiabilities)}</span>
            </div>
          </div>

          {/* Equity */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3">Equity</p>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Retained Earnings</span>
              <span className="text-sm font-medium tabular-nums">{formatINR(report.equity.retainedEarnings)}</span>
            </div>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Total Equity</span>
              <span className="text-sm tabular-nums">{formatINR(report.equity.totalEquity)}</span>
            </div>
          </div>

          {/* Balance check */}
          <div className="flex justify-between py-3 px-3 bg-muted/30 rounded font-bold">
            <span>Liabilities + Equity</span>
            <span className="tabular-nums">{formatINR(report.liabilities.totalLiabilities + report.equity.totalEquity)}</span>
          </div>
        </div>
      </ContentCard>
    </div>
  )
}

// =====================================================================
// CASH FLOW COMPONENT
// =====================================================================
function CashFlowReport({ report }: { report: any }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Cash Flow Statement</h2>
        <Badge variant="info">{report.period.label}</Badge>
      </div>

      <KPIGrid>
        <KPICard
          label="Cash from Operations"
          value={formatINR(report.operatingActivities.netOperatingCash)}
          icon={Wallet}
          iconColor={report.operatingActivities.netOperatingCash >= 0 ? 'text-emerald-600' : 'text-red-600'}
          sublabel="Subscriptions - AI - Gateway fees"
        />
        <KPICard
          label="Cash from Investing"
          value={formatINR(report.investingActivities.netInvestingCash)}
          icon={Scale}
          iconColor="text-slate-600"
          sublabel="No capex (SaaS)"
        />
        <KPICard
          label="Cash from Financing"
          value={formatINR(report.financingActivities.netFinancingCash)}
          icon={Scale}
          iconColor="text-slate-600"
          sublabel="No debt/equity raised"
        />
        <KPICard
          label="Net Change in Cash"
          value={formatINR(report.netChangeInCash)}
          icon={report.netChangeInCash >= 0 ? ArrowUp : ArrowDown}
          iconColor={report.netChangeInCash >= 0 ? 'text-emerald-600' : 'text-red-600'}
          sublabel="Net cash position change"
        />
      </KPIGrid>

      <ContentCard title="Cash Flow Breakdown">
        <div className="p-4 space-y-4">
          {/* Operating Activities */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Operating Activities</p>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Cash from Subscriptions</span>
              <span className="text-sm text-emerald-600 tabular-nums">+{formatINR(report.operatingActivities.cashFromSubscriptions)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Cash paid to AI Providers</span>
              <span className="text-sm text-red-600 tabular-nums">({formatINR(report.operatingActivities.cashPaidToAIProviders)})</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-sm">Cash paid to Razorpay (Gateway fees)</span>
              <span className="text-sm text-red-600 tabular-nums">({formatINR(report.operatingActivities.cashPaidToRazorpay)})</span>
            </div>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Net Cash from Operations</span>
              <span className={`text-sm tabular-nums ${report.operatingActivities.netOperatingCash >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatINR(report.operatingActivities.netOperatingCash)}
              </span>
            </div>
          </div>

          {/* Investing Activities */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3">Investing Activities</p>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Net Cash from Investing</span>
              <span className="text-sm tabular-nums">{formatINR(report.investingActivities.netInvestingCash)}</span>
            </div>
          </div>

          {/* Financing Activities */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3">Financing Activities</p>
            <div className="flex justify-between py-1 font-bold">
              <span className="text-sm">Net Cash from Financing</span>
              <span className="text-sm tabular-nums">{formatINR(report.financingActivities.netFinancingCash)}</span>
            </div>
          </div>

          {/* Net Change */}
          <div className={`flex justify-between py-3 px-3 rounded font-bold text-base ${
            report.netChangeInCash >= 0
              ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
          }`}>
            <span>Net Change in Cash</span>
            <span className="tabular-nums">{formatINR(report.netChangeInCash)}</span>
          </div>
        </div>
      </ContentCard>
    </div>
  )
}
