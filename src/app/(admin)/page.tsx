'use client'

import { useQuery } from '@tanstack/react-query'
import { Users, DollarSign, TrendingUp, Coins, AlertCircle, Activity as ActivityIcon, Loader2 } from 'lucide-react'
import { PageHeader, KPIGrid, KPICard, ContentCard, LoadingSkeleton, EmptyState } from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

export default function OverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    retry: 1,
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Dashboard" description="Real-time business overview" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
              <div className="h-3 bg-muted rounded w-1/2 mb-2" />
              <div className="h-6 bg-muted rounded w-3/4" />
            </div>
          ))}
        </div>
        <div className="bg-card rounded-xl border border-border">
          <LoadingSkeleton rows={5} />
        </div>
      </div>
    )
  }

  if (error || !data?.success) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Dashboard" description="Real-time business overview" />
        <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-6 text-center">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {error ? `Error: ${error.message}` : 'Failed to load dashboard data'}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            The database might be waking up. Please refresh in a few seconds.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600"
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  const stats = data.stats
  const conversionRate = stats.totalUsers > 0 ? (stats.payingUsers / stats.totalUsers) * 100 : 0
  const profitMargin = stats.monthRevenue > 0
    ? Math.round(((stats.monthRevenue - stats.monthAiCost) / stats.monthRevenue) * 100)
    : null

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Dashboard" description="Real-time business overview" />

      {/* 4 KPI cards */}
      <KPIGrid>
        <KPICard
          label="Total Users"
          value={formatNumber(stats.totalUsers)}
          delta={`+${stats.todaySignups} today`}
          deltaType="positive"
          icon={Users}
          iconColor="text-blue-500"
        />
        <KPICard
          label="MRR"
          value={formatINR(stats.monthRevenue)}
          sublabel={`${stats.payingUsers} paying (${conversionRate.toFixed(1)}%)`}
          icon={DollarSign}
          iconColor="text-emerald-500"
        />
        <KPICard
          label="GMV"
          value={formatINR(stats.totalGmv)}
          sublabel={`${formatNumber(stats.totalTransactions)} transactions`}
          icon={TrendingUp}
          iconColor="text-amber-500"
        />
        <KPICard
          label="AI Cost (Month)"
          value={formatINR(stats.monthAiCost)}
          sublabel={profitMargin !== null ? `${profitMargin}% margin` : '—'}
          icon={Coins}
          iconColor="text-orange-500"
        />
      </KPIGrid>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Active Today</p>
          <p className="text-lg font-bold mt-0.5">{formatNumber(stats.todayActiveUsers)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total AI Calls</p>
          <p className="text-lg font-bold mt-0.5">{formatNumber(stats.totalAiCalls)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">New Today</p>
          <p className="text-lg font-bold mt-0.5">{stats.todaySignups}</p>
        </div>
      </div>

      {/* Activity Feed */}
      <ContentCard>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-blue-500" />
              Live Activity Feed
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {data.activity?.summary ? `${data.activity.summary.total} events · auto-refresh 15s` : 'Loading...'}
            </span>
          </div>
          {data.activity?.events?.length === 0 ? (
            <EmptyState icon={ActivityIcon} title="No activity yet" description="Events from the last 7 days will appear here" />
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {data.activity?.events?.map((event: any) => (
                <div key={event.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                  <span className="text-base flex-shrink-0 mt-0.5">{event.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${event.color}`}>{event.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{event.description}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                    {formatRelativeTime(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </ContentCard>
    </div>
  )
}
