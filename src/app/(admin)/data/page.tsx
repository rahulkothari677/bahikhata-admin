'use client'

import { useQuery } from '@tanstack/react-query'
import { Database, TrendingUp, Crown, AlertCircle, FileText, IndianRupee } from 'lucide-react'
import { PageHeader, KPIGrid, KPICard, ContentCard, EmptyState, LoadingSkeleton, Badge } from '@/components/admin/ui'
import { formatINR, formatNumber } from '@/lib/utils'

export default function DataPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-data-monetization-v2'],
    queryFn: async () => {
      const r = await fetch('/api/admin/data-monetization')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Data Monetization" description="Credit scoring and lending pipeline" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
              <div className="h-3 bg-muted rounded w-1/2 mb-2" />
              <div className="h-6 bg-muted rounded w-3/4" />
            </div>
          ))}
        </div>
        <LoadingSkeleton rows={4} />
      </div>
    )
  }

  if (!data?.success) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Data Monetization" description="Credit scoring and lending pipeline" />
        <EmptyState icon={Database} title="Failed to load data" description="Please try refreshing" />
      </div>
    )
  }

  const { summary, lendingRevenue, totalLendingRevenuePotential } = data

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Data Monetization" description="Credit scoring and lending pipeline" />

      {/* Revenue potential banner */}
      <div className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 rounded-xl border border-violet-200 dark:border-violet-900 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Lending Revenue Potential</p>
            <p className="text-3xl font-bold text-violet-600 mt-1">{formatINR(totalLendingRevenuePotential)}</p>
            <p className="text-xs text-muted-foreground mt-1">From lead fees across {summary.totalScored} scored users</p>
          </div>
          <IndianRupee className="w-12 h-12 text-violet-400" />
        </div>
      </div>

      {/* 4 KPI cards */}
      <KPIGrid>
        <KPICard
          label="Scored Users"
          value={formatNumber(summary.totalScored)}
          sublabel={`Avg score: ${summary.avgScore}`}
          icon={Database}
          iconColor="text-violet-500"
        />
        <KPICard
          label="Excellent (750+)"
          value={formatNumber(summary.excellent)}
          sublabel="Prime lending candidates"
          icon={Crown}
          iconColor="text-emerald-500"
        />
        <KPICard
          label="Good (650-749)"
          value={formatNumber(summary.good)}
          sublabel="Standard lending"
          icon={TrendingUp}
          iconColor="text-blue-500"
        />
        <KPICard
          label="Fair (550-649)"
          value={formatNumber(summary.fair)}
          sublabel="Subprime candidates"
          icon={AlertCircle}
          iconColor="text-amber-500"
        />
      </KPIGrid>

      {/* Lending revenue breakdown */}
      <ContentCard title="Lending Revenue Breakdown">
        <div className="p-4">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2">Band</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Users</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Per Lead</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-muted/30">
                <td className="px-3 py-2"><Badge variant="success">Excellent</Badge></td>
                <td className="px-3 py-2 text-right tabular-nums">{lendingRevenue.excellent.count}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.excellent.potentialPerUser)}</td>
                <td className="px-3 py-2 text-right font-bold text-emerald-600">{formatINR(lendingRevenue.excellent.totalPotential)}</td>
              </tr>
              <tr className="hover:bg-muted/30">
                <td className="px-3 py-2"><Badge variant="info">Good</Badge></td>
                <td className="px-3 py-2 text-right tabular-nums">{lendingRevenue.good.count}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.good.potentialPerUser)}</td>
                <td className="px-3 py-2 text-right font-bold text-blue-600">{formatINR(lendingRevenue.good.totalPotential)}</td>
              </tr>
              <tr className="hover:bg-muted/30">
                <td className="px-3 py-2"><Badge variant="warning">Fair</Badge></td>
                <td className="px-3 py-2 text-right tabular-nums">{lendingRevenue.fair.count}</td>
                <td className="px-3 py-2 text-right">{formatINR(lendingRevenue.fair.potentialPerUser)}</td>
                <td className="px-3 py-2 text-right font-bold text-amber-600">{formatINR(lendingRevenue.fair.totalPotential)}</td>
              </tr>
            </tbody>
            <tfoot className="bg-muted/30 border-t-2 border-border">
              <tr>
                <td className="px-3 py-2 font-bold" colSpan={3}>Total Revenue Potential</td>
                <td className="px-3 py-2 text-right font-bold text-violet-600">{formatINR(totalLendingRevenuePotential)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </ContentCard>

      {/* Future revenue streams */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ContentCard title="GST Filing Service">
          <div className="p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Eligible users (scored)</span>
              <span className="font-medium">{formatNumber(summary.excellent + summary.good)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price per filing</span>
              <span className="font-medium">₹500 - ₹2,000</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 mt-2">
              <span className="font-medium">Monthly potential</span>
              <span className="font-bold text-emerald-600">
                {formatINR(Math.round((summary.excellent + summary.good) * 0.3) * 1000)}
              </span>
            </div>
          </div>
        </ContentCard>

        <ContentCard title="Supplier Intelligence">
          <div className="p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data collected</span>
              <span className="font-medium">Transactions + products + parties</span>
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
        </ContentCard>
      </div>

      {/* Compliance warning */}
      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              DPDP Act 2025 Compliance Required
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Before sharing any user data with NBFCs or FMCG companies: get explicit consent,
              allow revocation, share only anonymized data where possible, maintain audit trail,
              report breaches within 72 hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
