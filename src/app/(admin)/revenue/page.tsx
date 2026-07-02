'use client'

import { useQuery } from '@tanstack/react-query'
import { TrendingUp, DollarSign, Crown, AlertTriangle, RefreshCw } from 'lucide-react'
import { PageHeader, KPIGrid, KPICard, ContentCard, EmptyState, LoadingSkeleton, Badge } from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

export default function RevenuePage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-revenue'],
    queryFn: async () => {
      const r = await fetch('/api/admin/revenue')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 min cache
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="MRR & Forecast" description="Revenue analytics and forecasting" />
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
        <PageHeader title="MRR & Forecast" description="Revenue analytics and forecasting" />
        <EmptyState icon={DollarSign} title="Failed to load revenue data" description="Please try refreshing" />
      </div>
    )
  }

  const { forecast, ltv, churn, payments, mrrMovement } = data

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <PageHeader
        title="MRR & Forecast"
        description="Revenue analytics and forecasting"
        actions={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-xs font-medium hover:bg-muted/50 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* 4 KPI cards — THE most important revenue numbers */}
      <KPIGrid>
        <KPICard
          label="Current MRR"
          value={formatINR(forecast.currentMrr)}
          delta={`${forecast.growthRate > 0 ? '+' : ''}${forecast.growthRate}% MoM`}
          deltaType={forecast.growthRate >= 0 ? 'positive' : 'negative'}
          icon={DollarSign}
          iconColor="text-emerald-500"
        />
        <KPICard
          label="ARR (Annual)"
          value={formatINR(forecast.arr)}
          sublabel="Projected annual revenue"
          icon={TrendingUp}
          iconColor="text-blue-500"
        />
        <KPICard
          label="Average LTV"
          value={formatINR(ltv.ltv)}
          sublabel={`ARPU ${formatINR(ltv.arpu)} × ${ltv.avgLifetimeMonths}mo`}
          icon={Crown}
          iconColor="text-violet-500"
        />
        <KPICard
          label="Paying Users"
          value={formatNumber(ltv.payingUsers)}
          sublabel={`ARPU: ${formatINR(ltv.arpu)}`}
          icon={TrendingUp}
          iconColor="text-amber-500"
        />
      </KPIGrid>

      {/* MRR Movement — the ONE main content area */}
      {mrrMovement && (
        <ContentCard title="MRR Movement (This Month)">
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 p-3 bg-emerald-50 dark:bg-emerald-950/20">
                <p className="text-xs text-emerald-700 dark:text-emerald-400 uppercase">New MRR</p>
                <p className="text-xl font-bold text-emerald-600 mt-1">+{formatINR(mrrMovement.newMrr)}</p>
                <p className="text-[10px] text-muted-foreground">New subscriptions</p>
              </div>
              <div className="rounded-lg border border-blue-200 dark:border-blue-900 p-3 bg-blue-50 dark:bg-blue-950/20">
                <p className="text-xs text-blue-700 dark:text-blue-400 uppercase">Expansion</p>
                <p className="text-xl font-bold text-blue-600 mt-1">+{formatINR(mrrMovement.expansionMrr)}</p>
                <p className="text-[10px] text-muted-foreground">Upgrades (Pro→Elite)</p>
              </div>
              <div className="rounded-lg border border-red-200 dark:border-red-900 p-3 bg-red-50 dark:bg-red-950/20">
                <p className="text-xs text-red-700 dark:text-red-400 uppercase">Churned</p>
                <p className="text-xl font-bold text-red-600 mt-1">-{formatINR(mrrMovement.churnedMrr)}</p>
                <p className="text-[10px] text-muted-foreground">Cancellations</p>
              </div>
              <div className={`rounded-lg border p-3 ${mrrMovement.netMovement >= 0 ? 'border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/20' : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20'}`}>
                <p className="text-xs text-muted-foreground uppercase">Net Movement</p>
                <p className={`text-xl font-bold mt-1 ${mrrMovement.netMovement >= 0 ? 'text-violet-600' : 'text-red-600'}`}>
                  {mrrMovement.netMovement >= 0 ? '+' : ''}{formatINR(mrrMovement.netMovement)}
                </p>
                <p className="text-[10px] text-muted-foreground">New + Expansion - Churn</p>
              </div>
            </div>
          </div>
        </ContentCard>
      )}

      {/* Revenue Forecast — 3-month projection */}
      <ContentCard title="Revenue Forecast (Next 3 Months)">
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">This Month</p>
              <p className="text-xl font-bold text-emerald-600 mt-1">{formatINR(forecast.currentMrr)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Last: {formatINR(forecast.lastMonthRevenue)}</p>
            </div>
            {forecast.projections.map((proj: { month: string; projectedMrr: number }, i: number) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{proj.month}</p>
                <p className="text-xl font-bold mt-1">{formatINR(proj.projectedMrr)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {forecast.growthRate > 0 ? '↗' : '↘'} {Math.abs(forecast.growthRate)}% growth
                </p>
              </div>
            ))}
          </div>
        </div>
      </ContentCard>

      {/* Churn + Payment Health — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ContentCard title="Churn Tracking">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Cancelled</p>
                <p className="text-xs text-muted-foreground">Explicit cancellations</p>
              </div>
              <Badge variant="danger">{churn.cancelledUsers}</Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">At-Risk</p>
                <p className="text-xs text-muted-foreground">No activity 7+ days</p>
              </div>
              <Badge variant="warning">{churn.atRiskUsers}</Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Active 30d Ago</p>
                <p className="text-xs text-muted-foreground">Baseline for churn rate</p>
              </div>
              <Badge variant="info">{churn.active30DaysAgo}</Badge>
            </div>
          </div>
        </ContentCard>

        <ContentCard title="Payment Health">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Success Rate</p>
                <p className="text-xs text-muted-foreground">Active / total payments</p>
              </div>
              <Badge variant={payments.successRate >= 90 ? 'success' : 'warning'}>
                {payments.successRate}%
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Total Payments</p>
                <p className="text-xs text-muted-foreground">All subscription payments</p>
              </div>
              <span className="text-sm font-bold">{payments.total}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Cancelled</p>
                <p className="text-xs text-muted-foreground">User-initiated</p>
              </div>
              <Badge variant="danger">{payments.cancelled}</Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Expired</p>
                <p className="text-xs text-muted-foreground">Auto-expired (non-payment)</p>
              </div>
              <Badge variant="warning">{payments.expired}</Badge>
            </div>
          </div>
        </ContentCard>
      </div>

      {/* Actionable insights */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-600" />
          Actionable Insights
        </h2>
        <div className="space-y-2 text-sm">
          {forecast.currentMrr === 0 && (
            <p>💡 No revenue yet. Focus on converting free users to paid — target 5% conversion rate.</p>
          )}
          {churn.atRiskUsers > 0 && (
            <p>⚠️ {churn.atRiskUsers} users haven't been active in 7+ days. Send a re-engagement notification.</p>
          )}
          {payments.successRate > 0 && payments.successRate < 90 && (
            <p>⚠️ Payment success rate is {payments.successRate}% — investigate failed payments in Razorpay.</p>
          )}
          {forecast.growthRate > 0 && (
            <p>📈 Revenue growing at {forecast.growthRate}% MoM. Projected MRR in 3 months: {formatINR(forecast.projections[2]?.projectedMrr || 0)}</p>
          )}
        </div>
      </div>
    </div>
  )
}
