'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, DollarSign, TrendingUp, Coins, AlertCircle, RefreshCw, Activity as ActivityIcon } from 'lucide-react'
import { PageHeader, KPIGrid, KPICard, ContentCard, EmptyState, LoadingSkeleton, Badge } from '@/components/admin/ui'
import { formatINR, formatNumber } from '@/lib/utils'
import Link from 'next/link'
import { toast as sonnerToast } from 'sonner'

export default function OverviewPage() {
  const queryClient = useQueryClient()

  // Fetch pre-computed daily stats (instant — reads 1 row, not count() on millions)
  const { data: statsData, isLoading } = useQuery({
    queryKey: ['admin-daily-stats'],
    queryFn: async () => {
      const r = await fetch('/api/admin/compute-daily-stats')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 min — stats don't change frequently
  })

  // Trigger stats computation (if no stats exist yet)
  const computeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/compute-daily-stats', { method: 'POST' })
      return r.json()
    },
    onSuccess: () => {
      sonnerToast.success('Stats refreshed')
      queryClient.invalidateQueries({ queryKey: ['admin-daily-stats'] })
    },
    onError: (err: Error) => sonnerToast.error('Failed to refresh stats', { description: err.message }),
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
        <LoadingSkeleton rows={3} />
      </div>
    )
  }

  if (!statsData?.success || !statsData.stats || statsData.stats.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Dashboard" description="Real-time business overview" />
        <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-6 text-center">
          <AlertCircle className="w-8 h-8 text-blue-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Stats not computed yet</p>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 mb-3">
            Click the button below to compute today's stats. This runs aggregate queries and stores the results for instant dashboard loading.
          </p>
          <button
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {computeMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Compute Stats
          </button>
        </div>
      </div>
    )
  }

  // Latest day's stats (first item since sorted desc)
  const today = statsData.stats[0]
  const yesterday = statsData.stats[1]

  // Calculate deltas
  const userDelta = yesterday ? today.newUsers : today.newUsers
  const aiCostDelta = yesterday ? ((today.aiCostInr - yesterday.aiCostInr) / Math.max(yesterday.aiCostInr, 1) * 100).toFixed(1) : null
  const gmvDelta = yesterday ? ((today.totalGmv - yesterday.totalGmv) / Math.max(yesterday.totalGmv, 1) * 100).toFixed(1) : null

  return (
    <div className="p-6 space-y-6">
      {/* Header with refresh button */}
      <PageHeader
        title="Dashboard"
        description="Business overview"
        actions={
          <button
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-xs font-medium hover:bg-muted/50 transition disabled:opacity-50"
            title="Recompute stats from live data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${computeMutation.isPending ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* Last updated */}
      <p className="text-[10px] text-muted-foreground -mt-4">
        Last updated: {new Date(today.computedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>

      {/* 4 KPI cards — from pre-computed DailyStats */}
      <KPIGrid>
        <KPICard
          label="Total Users"
          value={formatNumber(today.totalUsers)}
          delta={`+${today.newUsers} today`}
          deltaType="positive"
          icon={Users}
          iconColor="text-blue-500"
        />
        <KPICard
          label="MRR"
          value={formatINR(today.mrr)}
          sublabel={`${today.payingUsers} paying · ARR ${formatINR(today.arr)}`}
          icon={DollarSign}
          iconColor="text-emerald-500"
        />
        <KPICard
          label="GMV"
          value={formatINR(today.totalGmv)}
          delta={gmvDelta ? `${parseFloat(gmvDelta) > 0 ? '+' : ''}${gmvDelta}%` : undefined}
          deltaType={gmvDelta && parseFloat(gmvDelta) >= 0 ? 'positive' : 'negative'}
          sublabel={`${formatNumber(today.totalTxns)} txns today`}
          icon={TrendingUp}
          iconColor="text-amber-500"
        />
        <KPICard
          label="AI Cost (Month)"
          value={formatINR(today.aiCostInr)}
          delta={aiCostDelta ? `${parseFloat(aiCostDelta) > 0 ? '+' : ''}${aiCostDelta}%` : undefined}
          deltaType={aiCostDelta && parseFloat(aiCostDelta) <= 0 ? 'positive' : 'negative'}
          sublabel={`${today.aiCalls} calls today`}
          icon={Coins}
          iconColor="text-orange-500"
        />
      </KPIGrid>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Active Today</p>
          <p className="text-lg font-bold mt-0.5">{formatNumber(today.activeUsers)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Sales Today</p>
          <p className="text-lg font-bold mt-0.5">{today.salesCount}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">New Today</p>
          <p className="text-lg font-bold mt-0.5">{today.newUsers}</p>
        </div>
      </div>

      {/* 30-day trend chart (simple bar chart from DailyStats) */}
      <ContentCard title="30-Day Trend">
        <div className="p-4">
          {statsData.stats.length < 2 ? (
            <EmptyState icon={TrendingUp} title="Not enough data" description="Need at least 2 days of stats to show a trend" />
          ) : (
            <div className="space-y-3">
              {/* Users trend */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Total Users (cumulative)</span>
                  <span className="font-bold">{formatNumber(today.totalUsers)}</span>
                </div>
                <div className="flex items-end gap-0.5 h-16">
                  {[...statsData.stats].reverse().map((s: any, i: number) => {
                    const max = Math.max(...statsData.stats.map((x: any) => x.totalUsers), 1)
                    const height = (s.totalUsers / max) * 100
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-blue-500/60 rounded-sm min-w-[2px] hover:bg-blue-500 transition"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}: ${formatNumber(s.totalUsers)} users`}
                      />
                    )
                  })}
                </div>
              </div>

              {/* AI Cost trend */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">AI Cost (daily)</span>
                  <span className="font-bold">{formatINR(today.aiCostInr)}</span>
                </div>
                <div className="flex items-end gap-0.5 h-16">
                  {[...statsData.stats].reverse().map((s: any, i: number) => {
                    const max = Math.max(...statsData.stats.map((x: any) => x.aiCostInr), 1)
                    const height = (s.aiCostInr / max) * 100
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-orange-500/60 rounded-sm min-w-[2px] hover:bg-orange-500 transition"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}: ${formatINR(s.aiCostInr)}`}
                      />
                    )
                  })}
                </div>
              </div>

              {/* GMV trend */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">GMV (cumulative)</span>
                  <span className="font-bold">{formatINR(today.totalGmv)}</span>
                </div>
                <div className="flex items-end gap-0.5 h-16">
                  {[...statsData.stats].reverse().map((s: any, i: number) => {
                    const max = Math.max(...statsData.stats.map((x: any) => x.totalGmv), 1)
                    const height = (s.totalGmv / max) * 100
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-emerald-500/60 rounded-sm min-w-[2px] hover:bg-emerald-500 transition"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}: ${formatINR(s.totalGmv)}`}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </ContentCard>

      {/* Link to Activity Log */}
      <Link
        href="/activity"
        className="block bg-card rounded-xl border border-border p-4 hover:border-primary/30 hover:bg-primary/5 transition group"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <ActivityIcon className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Activity Log</p>
              <p className="text-xs text-muted-foreground">View all recent events (signups, transactions, AI calls, admin actions)</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground group-hover:text-primary transition">View →</span>
        </div>
      </Link>
    </div>
  )
}
