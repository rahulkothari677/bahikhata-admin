'use client'

import { useQuery } from '@tanstack/react-query'
import { Database, TrendingUp, Crown, AlertCircle, Loader2, IndianRupee, FileText, BarChart3 } from 'lucide-react'
import { StatCard } from '@/components/admin/stat-card'
import { formatINR, formatNumber } from '@/lib/utils'

export default function DataPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-data-monetization'],
    queryFn: async () => {
      const r = await fetch('/api/admin/data-monetization')
      return r.json()
    },
    refetchInterval: 60000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Computing credit scores...</span>
      </div>
    )
  }

  if (!data?.success) return <div className="p-6 text-muted-foreground">Failed to load data</div>

  const { summary, lendingRevenue, totalLendingRevenuePotential, totalLoanCommissionPotential, topCandidates } = data

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="w-6 h-6 text-violet-600" />
          Data Monetization
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Credit scoring, lending leads, and revenue from data products
        </p>
      </div>

      {/* Revenue Potential Banner */}
      <div className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 rounded-xl border border-violet-200 dark:border-violet-900 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Data Revenue Potential</p>
            <p className="text-3xl font-bold text-violet-600 mt-1">
              {formatINR(totalLendingRevenuePotential + totalLoanCommissionPotential)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatINR(totalLendingRevenuePotential)} from lead fees + {formatINR(totalLoanCommissionPotential)} from loan commissions
            </p>
          </div>
          <IndianRupee className="w-12 h-12 text-violet-400" />
        </div>
      </div>

      {/* Credit Score Distribution */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-500" />
          Credit Score Distribution ({summary.totalScoredUsers} users scored)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Excellent */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 p-3 bg-emerald-50 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Excellent (750-900)</p>
                <p className="text-2xl font-bold text-emerald-600 mt-1">{summary.excellentCount}</p>
              </div>
              <Crown className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Prime lending candidates</p>
          </div>
          {/* Good */}
          <div className="rounded-lg border border-blue-200 dark:border-blue-900 p-3 bg-blue-50 dark:bg-blue-950/20">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Good (650-749)</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{summary.goodCount}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Standard lending candidates</p>
          </div>
          {/* Fair */}
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 p-3 bg-amber-50 dark:bg-amber-950/20">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Fair (550-649)</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{summary.fairCount}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Subprime candidates</p>
          </div>
          {/* Poor */}
          <div className="rounded-lg border border-red-200 dark:border-red-900 p-3 bg-red-50 dark:bg-red-950/20">
            <p className="text-xs font-medium text-red-700 dark:text-red-400">Poor (300-549)</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{summary.poorCount}</p>
            <p className="text-[10px] text-muted-foreground mt-1">High risk — do not lend</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Average Score:</span>
          <span className="font-bold text-lg">{summary.avgScore}</span>
        </div>
      </div>

      {/* Lending Revenue Breakdown */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          Lending Revenue Potential
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2">Band</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Users</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Avg Loan</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Lead Fee</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Loan Commission</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Total Potential</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-muted/30">
                <td className="px-3 py-2"><span className="text-emerald-600 font-medium">Excellent</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{lendingRevenue.excellent.count}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.excellent.avgLoanAmount)}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.excellent.potentialPerUser)}/lead</td>
                <td className="px-3 py-2 text-right text-emerald-600 font-medium">{formatINR(lendingRevenue.excellent.totalLoanDisbursalPotential)}</td>
                <td className="px-3 py-2 text-right font-bold">{formatINR(lendingRevenue.excellent.totalPotential + lendingRevenue.excellent.totalLoanDisbursalPotential)}</td>
              </tr>
              <tr className="hover:bg-muted/30">
                <td className="px-3 py-2"><span className="text-blue-600 font-medium">Good</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{lendingRevenue.good.count}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.good.avgLoanAmount)}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.good.potentialPerUser)}/lead</td>
                <td className="px-3 py-2 text-right text-blue-600 font-medium">{formatINR(lendingRevenue.good.totalLoanDisbursalPotential)}</td>
                <td className="px-3 py-2 text-right font-bold">{formatINR(lendingRevenue.good.totalPotential + lendingRevenue.good.totalLoanDisbursalPotential)}</td>
              </tr>
              <tr className="hover:bg-muted/30">
                <td className="px-3 py-2"><span className="text-amber-600 font-medium">Fair</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{lendingRevenue.fair.count}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.fair.avgLoanAmount)}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.fair.potentialPerUser)}/lead</td>
                <td className="px-3 py-2 text-right text-amber-600 font-medium">{formatINR(lendingRevenue.fair.totalLoanDisbursalPotential)}</td>
                <td className="px-3 py-2 text-right font-bold">{formatINR(lendingRevenue.fair.totalPotential + lendingRevenue.fair.totalLoanDisbursalPotential)}</td>
              </tr>
            </tbody>
            <tfoot className="bg-muted/30 border-t-2 border-border">
              <tr>
                <td className="px-3 py-2 font-bold">Total</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{lendingRevenue.excellent.count + lendingRevenue.good.count + lendingRevenue.fair.count}</td>
                <td colSpan={3} className="px-3 py-2 text-right text-muted-foreground">Combined revenue potential:</td>
                <td className="px-3 py-2 text-right font-bold text-violet-600">
                  {formatINR(totalLendingRevenuePotential + totalLoanCommissionPotential)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Top Lending Candidates */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-500" />
          Top Lending Candidates (Best 20)
        </h2>
        {topCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No scored users yet. Users need transactions for credit scoring.
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {topCandidates.map((candidate: any, i: number) => (
              <div key={candidate.userId} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition">
                <span className="text-xs font-bold text-muted-foreground w-6">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{candidate.userName}</p>
                  <p className="text-xs text-muted-foreground truncate">{candidate.userEmail}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold">{candidate.totalScore}</p>
                  <p className="text-[10px] text-muted-foreground">avg {formatINR(candidate.metrics.avgMonthlySales)}/mo</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                  candidate.band === 'excellent' ? 'bg-emerald-100 text-emerald-700' :
                  candidate.band === 'good' ? 'bg-blue-100 text-blue-700' :
                  candidate.band === 'fair' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {candidate.band}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Future Revenue Streams */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" />
            GST Filing Service
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Users with GST data</span>
              <span className="font-medium">{summary.excellentCount + summary.goodCount} estimated</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price per filing</span>
              <span className="font-medium">₹500 - ₹2,000</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly filings (est.)</span>
              <span className="font-medium">{Math.round((summary.excellentCount + summary.goodCount) * 0.3)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 mt-2">
              <span className="font-medium">Monthly potential</span>
              <span className="font-bold text-emerald-600">
                {formatINR(Math.round((summary.excellentCount + summary.goodCount) * 0.3) * 1000)}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            💡 Partner with CAs to offer GST filing. You handle data collection, CA handles filing.
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Database className="w-4 h-4 text-violet-500" />
            Supplier Intelligence
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data points collected</span>
              <span className="font-medium">Transactions + products + parties</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Potential buyers</span>
              <span className="font-medium">HUL, ITC, Parle, etc.</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Report price range</span>
              <span className="font-medium">₹50K - ₹5L per report</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 mt-2">
              <span className="font-medium">Annual potential</span>
              <span className="font-bold text-violet-600">₹10L - ₹1Cr</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            💡 Aggregate purchase data shows market trends. FMCG companies pay for category-level insights.
          </p>
        </div>
      </div>

      {/* Compliance Warning */}
      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              DPDP Act 2025 Compliance Required
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Before sharing any user data with NBFCs or FMCG companies, you MUST:
              <br />
              1. Get explicit user consent for data sharing (DPDP Act requirement)
              <br />
              2. Allow users to revoke consent at any time
              <br />
              3. Share only aggregated/anonymized data where possible
              <br />
              4. Maintain audit trail of all data sharing
              <br />
              5. Report data breaches within 72 hours
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
