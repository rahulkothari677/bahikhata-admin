'use client'

import { useQuery } from '@tanstack/react-query'
import { Coins, Zap, Clock, TrendingUp, Loader2, AlertCircle } from 'lucide-react'
import { StatCard } from '@/components/admin/stat-card'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

export default function AIUsagePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-ai-usage'],
    queryFn: async () => {
      const r = await fetch('/api/admin/ai-usage')
      return r.json()
    },
    refetchInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.success) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 flex items-center gap-2 text-destructive">
          <AlertCircle className="w-5 h-5" />
          <span>Failed to load AI usage data</span>
        </div>
      </div>
    )
  }

  const { periods, featureBreakdown, providerBreakdown, topUsers, recentCalls } = data

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Coins className="w-6 h-6 text-amber-600" />
          AI Usage & Cost
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time AI cost tracking across all users</p>
      </div>

      {/* Period stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Today" value={formatINR(periods.today.costInr)} sublabel={`${periods.today.calls} calls · ${formatNumber(periods.today.totalTokens)} tokens`} icon={Zap} iconColor="text-amber-500" />
        <StatCard label="This Week" value={formatINR(periods.week.costInr)} sublabel={`${periods.week.calls} calls`} icon={TrendingUp} iconColor="text-blue-500" />
        <StatCard label="This Month" value={formatINR(periods.month.costInr)} sublabel={`${periods.month.calls} calls`} icon={Coins} iconColor="text-orange-500" />
        <StatCard label="All Time" value={formatINR(periods.allTime.costInr)} sublabel={`${periods.allTime.calls} calls`} icon={Clock} iconColor="text-violet-500" />
      </div>

      {/* Feature + Provider breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3">By Feature (This Month)</h2>
          <div className="space-y-2">
            {Object.entries(featureBreakdown).map(([feature, stats]: any) => (
              <div key={feature} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm font-medium capitalize">{feature.replace('-', ' ')}</span>
                <div className="text-right">
                  <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{formatINR(stats.costInr)}</p>
                  <p className="text-xs text-muted-foreground">{stats.calls} calls · {formatNumber(stats.totalTokens)} tokens</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3">By Provider (This Month)</h2>
          <div className="space-y-2">
            {Object.entries(providerBreakdown).filter(([, s]: any) => s.calls > 0).map(([provider, stats]: any) => (
              <div key={provider} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm font-medium capitalize">{provider}</span>
                <div className="text-right">
                  <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{formatINR(stats.costInr)}</p>
                  <p className="text-xs text-muted-foreground">{stats.calls} calls · {stats.successCount} success</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top users by cost */}
      {topUsers.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3">Top Users by AI Cost (This Month)</h2>
          <div className="space-y-2">
            {topUsers.map((u: any, i: number) => (
              <div key={u.userId} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-6">#{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{u.user?.name || u.user?.email || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">{u.user?.email}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{formatINR(u.costInr)}</p>
                  <p className="text-xs text-muted-foreground">{u.calls} calls</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent calls */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">Recent AI Calls (last 50)</h2>
        {recentCalls.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No AI calls yet</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {recentCalls.map((call: any) => (
              <div key={call.id} className={`flex items-center gap-3 p-2 rounded-lg text-xs ${call.success ? 'bg-muted/30' : 'bg-destructive/5'}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${call.success ? 'bg-success' : 'bg-destructive'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{call.feature.replace('-', ' ')}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="capitalize text-muted-foreground">{call.provider}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground truncate">{call.userEmail || 'unknown'}</span>
                  </div>
                  {!call.success && call.errorMessage && (
                    <p className="text-destructive text-[10px] mt-0.5 truncate">{call.errorMessage}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-mono">{formatNumber(call.totalTokens)} tokens</div>
                  <div className="font-bold text-amber-700 dark:text-amber-400">{formatINR(call.costInr)}</div>
                </div>
                <div className="text-right flex-shrink-0 text-muted-foreground">
                  <div>{call.durationMs}ms</div>
                  <div className="text-[10px]">{formatRelativeTime(call.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
