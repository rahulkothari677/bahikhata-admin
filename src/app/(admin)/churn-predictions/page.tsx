'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  TrendingDown, RefreshCw, Loader2, AlertCircle, Zap,
  CheckCircle2, AlertTriangle, ShieldAlert, Activity,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const RISK_CONFIG: Record<string, { color: string; badge: 'success' | 'warning' | 'danger' | 'neutral'; icon: any }> = {
  low: { color: 'text-emerald-600', badge: 'success', icon: CheckCircle2 },
  medium: { color: 'text-amber-600', badge: 'warning', icon: AlertTriangle },
  high: { color: 'text-orange-600', badge: 'warning', icon: AlertTriangle },
  critical: { color: 'text-red-600', badge: 'danger', icon: ShieldAlert },
}

export default function ChurnPredictionsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [riskFilter, setRiskFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all')
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'pro' | 'elite'>('all')

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-churn-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/churn-predictions?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-churn-list', page, riskFilter, planFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ tab: 'list', page: String(page), riskLevel: riskFilter, plan: planFilter })
      const r = await fetch(`/api/admin/churn-predictions?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  const computeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/churn-predictions/compute', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Computed predictions for ${data.totalUsers} users in ${(data.durationMs / 1000).toFixed(1)}s`,
        { description: `Critical: ${data.byLevel.critical} · High: ${data.byLevel.high} · Medium: ${data.byLevel.medium} · Low: ${data.byLevel.low}` }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-churn-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-churn-list'] })
    },
    onError: (err: Error) => toast.error('Compute failed', { description: err.message }),
  })

  const ov = overview?.overview || {}
  const predictions = listData?.predictions || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Predictive Churn Model"
        description="ML-based churn prediction · 6 risk factors · proactive retention recommendations"
        actions={
          <button
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {computeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Run Prediction
          </button>
        }
      />

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: Activity },
          { id: 'list' as const, label: 'At-Risk Users', icon: TrendingDown },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <>
          {overviewLoading ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
                    <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                    <div className="h-6 bg-muted rounded w-3/4" />
                  </div>
                ))}
              </div>
              <LoadingSkeleton rows={4} />
            </>
          ) : !overview?.success ? (
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              {/* Cache status */}
              {ov.lastComputedAt ? (
                <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-3 flex items-center gap-3">
                  <Activity className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Predictions last computed <strong>{formatRelativeTime(ov.lastComputedAt)}</strong>.
                    {ov.totalUsers > 0 && ` ${formatNumber(ov.totalUsers)} users analyzed. ${ov.atRiskPct}% at risk.`}
                  </p>
                </div>
              ) : (
                <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-3 flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    No predictions yet. Click <strong>Run Prediction</strong> to analyze all users.
                  </p>
                </div>
              )}

              <KPIGrid>
                <KPICard
                  label="At Risk (High + Critical)"
                  value={formatNumber(ov.atRiskCount || 0)}
                  icon={ShieldAlert}
                  iconColor="text-red-600"
                  sublabel={`${ov.atRiskPct || 0}% of all users`}
                />
                <KPICard
                  label="Critical Risk"
                  value={formatNumber(ov.criticalCount || 0)}
                  icon={AlertTriangle}
                  iconColor="text-red-600"
                  sublabel="Need immediate outreach"
                />
                <KPICard
                  label="High Risk"
                  value={formatNumber(ov.highCount || 0)}
                  icon={AlertTriangle}
                  iconColor="text-orange-600"
                  sublabel="Send win-back campaign"
                />
                <KPICard
                  label="Total Analyzed"
                  value={formatNumber(ov.totalUsers || 0)}
                  icon={Activity}
                  iconColor="text-blue-600"
                  sublabel="Users with churn prediction"
                />
              </KPIGrid>

              {/* Risk distribution */}
              <ContentCard title="Risk Distribution">
                <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                  {(['low', 'medium', 'high', 'critical'] as const).map(level => {
                    const cfg = RISK_CONFIG[level]
                    const Icon = cfg.icon
                    const count = (ov as any)[`${level}Count`] || 0
                    const pct = ov.totalUsers > 0 ? Math.round((count / ov.totalUsers) * 100) : 0
                    return (
                      <div key={level} className="text-center p-3 bg-muted/30 rounded-lg border border-border">
                        <Icon className={`w-6 h-6 mx-auto mb-1 ${cfg.color}`} />
                        <p className="text-2xl font-bold">{count}</p>
                        <p className={`text-xs font-medium capitalize ${cfg.color}`}>{level}</p>
                        <p className="text-[10px] text-muted-foreground">{pct}% of users</p>
                      </div>
                    )
                  })}
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How churn prediction works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">6 Risk Factors (weighted):</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Inactivity</strong> (25%): days since last login</li>
                      <li>• <strong>Engagement</strong> (25%): days since last transaction</li>
                      <li>• <strong>AI Usage Decline</strong> (15%): last 7d vs previous 7d</li>
                      <li>• <strong>Support Tickets</strong> (15%): open tickets = frustration</li>
                      <li>• <strong>Plan Tier</strong> (10%): free users churn more</li>
                      <li>• <strong>Account Age</strong> (10%): very new/old = higher risk</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Risk Levels + Actions:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Critical (76-100)</strong>: personal outreach + discount offer</li>
                      <li>• <strong>High (51-75)</strong>: send win-back campaign (SMS + email)</li>
                      <li>• <strong>Medium (26-50)</strong>: monitor for 7 days + re-engage</li>
                      <li>• <strong>Low (0-25)</strong>: no action needed</li>
                      <li>• Uses bulk groupBy queries (not per-user) — scales to millions</li>
                      <li>• Run daily via cron for fresh predictions</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* LIST TAB */}
      {tab === 'list' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'critical', 'high', 'medium', 'low'] as const).map(r => (
              <button
                key={r}
                onClick={() => { setRiskFilter(r); setPage(1) }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                  riskFilter === r ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {r}
              </button>
            ))}
            <span className="text-xs text-muted-foreground mx-2">|</span>
            {(['all', 'free', 'pro', 'elite'] as const).map(p => (
              <button
                key={p}
                onClick={() => { setPlanFilter(p); setPage(1) }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                  planFilter === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <ContentCard title={`At-Risk Users — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={10} />
            ) : predictions.length === 0 ? (
              <EmptyState
                icon={TrendingDown}
                title="No predictions found"
                description={riskFilter !== 'all' || planFilter !== 'all' ? "Try adjusting filters" : "Click 'Run Prediction' to analyze users"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">User</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Risk Score</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Level</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Plan</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Top Factors</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Recommendation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {predictions.map((p: any) => {
                    const cfg = RISK_CONFIG[p.riskLevel] || RISK_CONFIG.low
                    // Find top 2 factors
                    const factors = [
                      { name: 'Inactive', score: p.inactivityScore },
                      { name: 'No Txns', score: p.engagementScore },
                      { name: 'AI Drop', score: p.aiUsageScore },
                      { name: 'Plan', score: p.planScore },
                      { name: 'Age', score: p.ageScore },
                      { name: 'Support', score: p.supportScore },
                    ].sort((a, b) => b.score - a.score).slice(0, 2)

                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition">
                        <td className="px-4 py-3">
                          <Link href={`/users/${p.userId}`} className="hover:underline">
                            <p className="text-sm font-medium">{p.userName || p.userEmail || p.userId.slice(0, 12)}</p>
                            <p className="text-xs text-muted-foreground">{p.userEmail}</p>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-lg font-bold ${cfg.color}`}>{p.riskScore}</span>
                          <span className="text-[10px] text-muted-foreground">/100</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={cfg.badge}>{p.riskLevel}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={p.userPlan === 'elite' ? 'info' : p.userPlan === 'pro' ? 'warning' : 'neutral'}>
                            {p.userPlan}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {factors.map(f => (
                              <div key={f.name} className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground w-16">{f.name}</span>
                                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${f.score >= 75 ? 'bg-red-500' : f.score >= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${f.score}%` }}
                                  />
                                </div>
                                <span className="text-muted-foreground w-6">{f.score}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs">
                          {p.recommendedAction || 'No action needed'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </ContentCard>

          {total > 0 && (
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  )
}
