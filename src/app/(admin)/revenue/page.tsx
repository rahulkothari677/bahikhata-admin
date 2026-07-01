'use client'

import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Users, DollarSign, Crown, AlertTriangle, Loader2, Calendar } from 'lucide-react'
import { StatCard } from '@/components/admin/stat-card'
import { formatINR, formatNumber } from '@/lib/utils'

export default function RevenuePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-revenue'],
    queryFn: async () => {
      const r = await fetch('/api/admin/revenue')
      return r.json()
    },
    refetchInterval: 60000, // refresh every minute
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.success) {
    return <div className="p-6 text-muted-foreground">Failed to load revenue analytics</div>
  }

  const { cohortRetention, churn, ltv, forecast, payments } = data

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-emerald-600" />
          Revenue Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cohort retention, churn, LTV, and revenue forecasting
        </p>
      </div>

      {/* Top stats — 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Current MRR"
          value={formatINR(forecast.currentMrr)}
          delta={`${forecast.growthRate > 0 ? '+' : ''}${forecast.growthRate}% MoM`}
          deltaType={forecast.growthRate >= 0 ? 'positive' : 'negative'}
          icon={DollarSign}
          iconColor="text-emerald-500"
        />
        <StatCard
          label="ARR (Annual)"
          value={formatINR(forecast.arr)}
          sublabel="Projected annual revenue"
          icon={TrendingUp}
          iconColor="text-blue-500"
        />
        <StatCard
          label="Average LTV"
          value={formatINR(ltv.ltv)}
          sublabel={`${formatINR(ltv.arpu)}/mo × ${ltv.avgLifetimeMonths}mo`}
          icon={Crown}
          iconColor="text-violet-500"
        />
        <StatCard
          label="Paying Users"
          value={formatNumber(ltv.payingUsers)}
          sublabel={`ARPU: ${formatINR(ltv.arpu)}`}
          icon={Users}
          iconColor="text-amber-500"
        />
      </div>

      {/* Revenue Forecast */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-500" />
          Revenue Forecast (Next 3 Months)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Current month */}
          <div className="rounded-lg border border-border p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground">This Month (actual)</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{formatINR(forecast.currentMrr)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Last month: {formatINR(forecast.lastMonthRevenue)}
            </p>
          </div>
          {/* Forecast months */}
          {forecast.projections.map((proj: { month: string; projectedMrr: number }, i: number) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{proj.month} (projected)</p>
              <p className="text-xl font-bold mt-1">{formatINR(proj.projectedMrr)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {forecast.growthRate > 0 ? '↗' : '↘'} {Math.abs(forecast.growthRate)}% growth rate
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          💡 Forecast assumes current growth rate continues. Actual results depend on churn, pricing changes, and acquisition.
        </div>
      </div>

      {/* Cohort Retention */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          Cohort Retention (Last 8 Weeks)
        </h2>
        {cohortRetention.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No cohort data yet. Users need to sign up and return over multiple weeks.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2">Cohort Week</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Size</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase px-3 py-2">Week 0</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase px-3 py-2">Week 1</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase px-3 py-2">Week 2</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase px-3 py-2">Week 3</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase px-3 py-2">Week 4</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cohortRetention.map((cohort: any, i: number) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs">
                      {new Date(cohort.cohortWeek).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{cohort.cohortSize}</td>
                    {cohort.retention.map((pct: number, weekIdx: number) => (
                      <td key={weekIdx} className="px-3 py-2 text-center">
                        {pct === -1 ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            pct >= 50 ? 'bg-success/10 text-success' :
                            pct >= 25 ? 'bg-amber-100 text-amber-700' :
                            pct > 0 ? 'bg-destructive/10 text-destructive' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {pct}%
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 text-xs text-muted-foreground">
          💡 "Active" = user had a transaction or AI call during that week. Week 0 = signup week.
          Healthy apps see 30%+ retention by week 4.
        </div>
      </div>

      {/* Churn + Payments — 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Churn */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Churn Tracking
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Cancelled Subscriptions</p>
                <p className="text-xs text-muted-foreground">Users who explicitly cancelled</p>
              </div>
              <p className="text-xl font-bold text-destructive">{churn.cancelledUsers}</p>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">At-Risk Users</p>
                <p className="text-xs text-muted-foreground">No activity in 7+ days</p>
              </div>
              <p className="text-xl font-bold text-amber-600">{churn.atRiskUsers}</p>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Active 30 Days Ago</p>
                <p className="text-xs text-muted-foreground">Baseline for churn rate</p>
              </div>
              <p className="text-xl font-bold text-blue-600">{churn.active30DaysAgo}</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            💡 Churn rate = (cancelled + at-risk) / active 30 days ago. Target: under 5% monthly.
          </div>
        </div>

        {/* Payments */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            Payment Health
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Total Payments</p>
                <p className="text-xs text-muted-foreground">All subscription payments</p>
              </div>
              <p className="text-xl font-bold">{payments.total}</p>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Success Rate</p>
                <p className="text-xs text-muted-foreground">Active / total</p>
              </div>
              <p className={`text-xl font-bold ${payments.successRate >= 90 ? 'text-success' : 'text-amber-600'}`}>
                {payments.successRate}%
              </p>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div>
                <p className="text-sm font-medium">Cancelled</p>
                <p className="text-xs text-muted-foreground">User-initiated cancellations</p>
              </div>
              <p className="text-xl font-bold text-destructive">{payments.cancelled}</p>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Expired</p>
                <p className="text-xs text-muted-foreground">Auto-expired (non-payment)</p>
              </div>
              <p className="text-xl font-bold text-amber-600">{payments.expired}</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            💡 Success rate below 90% indicates payment issues. Check Razorpay dashboard for failed transactions.
          </div>
        </div>
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
            <p>⚠️ {churn.atRiskUsers} users haven't been active in 7+ days. Consider sending a re-engagement notification.</p>
          )}
          {cohortRetention.length > 0 && cohortRetention[0]?.retention[4] !== undefined && cohortRetention[0]?.retention[4] >= 0 && (
            <p>
              {cohortRetention[0].retention[4] >= 30
                ? `✅ Week 4 retention is ${cohortRetention[0].retention[4]}% — healthy!`
                : `⚠️ Week 4 retention is only ${cohortRetention[0].retention[4]}% — consider improving onboarding.`
              }
            </p>
          )}
          {payments.successRate > 0 && payments.successRate < 90 && (
            <p>⚠️ Payment success rate is {payments.successRate}% — investigate failed payments in Razorpay.</p>
          )}
          {forecast.growthRate > 0 && (
            <p>📈 Revenue growing at {forecast.growthRate}% MoM. At this rate, projected MRR in 3 months: {formatINR(forecast.projections[2]?.projectedMrr || 0)}</p>
          )}
        </div>
      </div>
    </div>
  )
}
