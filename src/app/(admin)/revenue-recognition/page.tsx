'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  TrendingUp, RefreshCw, Loader2, Calendar, CheckCircle2,
  Clock, AlertCircle, Wallet, BarChart3, FileBarChart,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'schedules' | 'monthly'

const PAGE_SIZE = 20

const STATUS_BADGE: Record<string, 'warning' | 'info' | 'success'> = {
  pending: 'warning',
  current: 'info',
  recognized: 'success',
}

const STATUS_ICON: Record<string, any> = {
  pending: Clock,
  current: Calendar,
  recognized: CheckCircle2,
}

export default function RevenueRecognitionPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'current' | 'recognized'>('all')

  // ============ OVERVIEW DATA ============
  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-revenue-recognition-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/revenue-recognition?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ SCHEDULES DATA ============
  const { data: schedulesData, isLoading: schedulesLoading } = useQuery({
    queryKey: ['admin-revenue-schedules', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'schedules',
        page: String(page),
        status: statusFilter,
      })
      const r = await fetch(`/api/admin/revenue-recognition?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'schedules',
    staleTime: 30 * 1000,
  })

  // ============ MONTHLY DATA ============
  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ['admin-revenue-monthly', 12],
    queryFn: async () => {
      const r = await fetch('/api/admin/revenue-recognition?tab=monthly&months=12')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'monthly',
    staleTime: 60 * 1000,
  })

  // ============ RECOMPUTE MUTATION ============
  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/revenue-recognition/recompute', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Recomputed — ${data.subscriptionsProcessed} subscriptions, ${data.entriesCreated} entries in ${(data.durationMs / 1000).toFixed(1)}s`
      )
      queryClient.invalidateQueries({ queryKey: ['admin-revenue-recognition-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-revenue-schedules'] })
      queryClient.invalidateQueries({ queryKey: ['admin-revenue-monthly'] })
    },
    onError: (err: Error) => {
      toast.error('Recompute failed', { description: err.message })
    },
  })

  // ============ COOLDOWN POLL ============
  const { data: cooldownData } = useQuery({
    queryKey: ['admin-revenue-recompute-cooldown'],
    queryFn: async () => {
      const r = await fetch('/api/admin/revenue-recognition/recompute')
      if (!r.ok) return { canRecompute: true, cooldownRemainingSeconds: 0 }
      return r.json()
    },
    refetchInterval: recomputeMutation.isPending ? 1000 : false,
    staleTime: 10 * 1000,
  })

  const ov = overviewData?.overview || {}
  const currentMonth = overviewData?.currentMonth
  const lastMonth = overviewData?.lastMonth
  const recognizedDelta = overviewData?.recognizedDeltaPct || 0
  const schedules = schedulesData?.schedules || []
  const schedulesTotal = schedulesData?.total || 0
  const schedulesTotalPages = schedulesData?.totalPages || 0
  const monthly = monthlyData?.monthly || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Revenue Recognition"
        description="Accrual-based revenue tracking · deferred → recognized over subscription period (GAAP/Ind AS compliant)"
        actions={
          <button
            onClick={() => recomputeMutation.mutate()}
            disabled={recomputeMutation.isPending || (cooldownData && !cooldownData.canRecompute)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recomputeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Recomputing...
              </>
            ) : cooldownData && !cooldownData.canRecompute ? (
              <>
                <RefreshCw className="w-4 h-4" />
                Cooldown {cooldownData.cooldownRemainingSeconds}s
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Recompute Schedules
              </>
            )}
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'schedules' as const, label: 'Schedule Entries', icon: Calendar },
          { id: 'monthly' as const, label: 'Monthly Breakdown', icon: BarChart3 },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t.id
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

      {/* ============ OVERVIEW TAB ============ */}
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
          ) : !overviewData?.success ? (
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Recognized Revenue"
                  value={formatINR(ov.totalRecognized || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.recognizedPeriods || 0} periods recognized`}
                />
                <KPICard
                  label="Deferred Revenue (Liability)"
                  value={formatINR(ov.totalDeferred || 0)}
                  icon={Clock}
                  iconColor="text-amber-600"
                  sublabel={`${ov.pendingPeriods || 0} pending periods`}
                />
                <KPICard
                  label="Current Month Revenue"
                  value={formatINR(ov.currentMonthRevenue || 0)}
                  icon={Wallet}
                  iconColor="text-blue-600"
                  sublabel={currentMonth ? `Month: ${currentMonth.month}` : 'This month'}
                />
                <KPICard
                  label="Total Scheduled"
                  value={formatINR(ov.totalScheduled || 0)}
                  icon={FileBarChart}
                  iconColor="text-violet-600"
                  sublabel="Across all subscriptions"
                />
              </KPIGrid>

              {/* Month-over-month comparison */}
              {currentMonth && lastMonth && (
                <ContentCard title="Month-over-Month Comparison">
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 bg-muted/30 rounded-lg border border-border">
                      <p className="text-xs text-muted-foreground uppercase">Last Month ({lastMonth.month})</p>
                      <p className="text-2xl font-bold mt-1">{formatINR(lastMonth.recognized)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Deferred at month end: {formatINR(lastMonth.deferred)}
                      </p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg border border-border">
                      <p className="text-xs text-muted-foreground uppercase">This Month ({currentMonth.month})</p>
                      <p className="text-2xl font-bold mt-1">{formatINR(currentMonth.recognized)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Deferred at month end: {formatINR(currentMonth.deferred)}
                      </p>
                      {recognizedDelta !== 0 && (
                        <span className="inline-block mt-2">
                          <Badge variant={recognizedDelta > 0 ? 'success' : 'danger'}>
                            {recognizedDelta > 0 ? '↑' : '↓'} {Math.abs(recognizedDelta)}% vs last month
                          </Badge>
                        </span>
                      )}
                    </div>
                  </div>
                </ContentCard>
              )}

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How revenue recognition works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Accrual Accounting Principle:</p>
                    <ul className="space-y-0.5">
                      <li>• Cash received upfront (e.g. ₹2,988 for yearly Pro on Jan 1)</li>
                      <li>• Revenue recognized over subscription period (₹249/month × 12 months)</li>
                      <li>• <strong>Deferred revenue</strong> = unearned portion (liability on balance sheet)</li>
                      <li>• <strong>Recognized revenue</strong> = earned portion (appears on income statement)</li>
                      <li>• Compliant with GAAP (US) and Ind AS 115 (India)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Schedule Entry Lifecycle:</p>
                    <ul className="space-y-0.5">
                      <li>• <code className="text-[11px] bg-muted px-1 rounded">pending</code> — future month (not yet earned)</li>
                      <li>• <code className="text-[11px] bg-muted px-1 rounded">current</code> — this month (being earned)</li>
                      <li>• <code className="text-[11px] bg-muted px-1 rounded">recognized</code> — past month (fully earned)</li>
                      <li>• One entry per subscription per month</li>
                      <li>• Click "Recompute Schedules" to recalculate from scratch</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ SCHEDULES TAB ============ */}
      {tab === 'schedules' && (
        <>
          <div className="flex items-center gap-2">
            {(['all', 'pending', 'current', 'recognized'] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <ContentCard title={`Revenue Schedule Entries — ${schedulesTotal} total`}>
            {schedulesLoading ? (
              <LoadingSkeleton rows={10} />
            ) : schedules.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="No schedule entries"
                description={statusFilter !== 'all'
                  ? "Try a different filter"
                  : "Click 'Recompute Schedules' to generate entries from subscriptions"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Period</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Plan</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Amount</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Recognized At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schedules.map((s: any) => {
                    const StatusIcon = STATUS_ICON[s.status] || Clock
                    return (
                      <tr key={s.id} className="hover:bg-muted/30 transition">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium">
                            {new Date(s.periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={s.plan === 'elite' ? 'info' : 'warning'}>{s.plan}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5">
                            <StatusIcon className={`w-3.5 h-3.5 ${
                              s.status === 'recognized' ? 'text-emerald-600' :
                              s.status === 'current' ? 'text-blue-600' :
                              'text-amber-600'
                            }`} />
                            <Badge variant={STATUS_BADGE[s.status] || 'neutral'}>{s.status}</Badge>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                          {formatINR(s.amount)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {s.recognizedAt ? formatRelativeTime(s.recognizedAt) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </ContentCard>

          {schedulesTotal > 0 && (
            <Pagination
              page={page}
              totalPages={schedulesTotalPages}
              total={schedulesTotal}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* ============ MONTHLY TAB ============ */}
      {tab === 'monthly' && (
        <>
          {monthlyLoading ? (
            <LoadingSkeleton rows={12} />
          ) : !monthlyData?.success ? (
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : monthly.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No monthly data"
              description="Click 'Recompute Schedules' to generate data"
            />
          ) : (
            <>
              <ContentCard title="Monthly Revenue Breakdown (Last 12 Months)">
                <div className="p-4 space-y-3">
                  {/* Recognized revenue bar chart */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Recognized Revenue per Month</p>
                    <div className="space-y-1">
                      {(() => {
                        const maxRecognized = Math.max(...monthly.map((m: any) => m.recognized), 1)
                        return monthly.map((m: any) => (
                          <div key={m.month} className="flex items-center gap-3">
                            <span className="text-xs font-mono w-16 text-muted-foreground">{m.month}</span>
                            <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
                              <div
                                className="h-full bg-emerald-500 transition-all flex items-center justify-end pr-2"
                                style={{ width: `${Math.max((m.recognized / maxRecognized) * 100, 2)}%` }}
                              >
                                {m.recognized > 0 && (
                                  <span className="text-[10px] font-medium text-white">
                                    {formatINR(m.recognized)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>

                  {/* Deferred revenue bar chart */}
                  <div className="mt-6">
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Deferred Revenue (Liability) per Month</p>
                    <div className="space-y-1">
                      {(() => {
                        const maxDeferred = Math.max(...monthly.map((m: any) => m.deferred), 1)
                        return monthly.map((m: any) => (
                          <div key={m.month} className="flex items-center gap-3">
                            <span className="text-xs font-mono w-16 text-muted-foreground">{m.month}</span>
                            <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
                              <div
                                className="h-full bg-amber-500 transition-all flex items-center justify-end pr-2"
                                style={{ width: `${Math.max((m.deferred / maxDeferred) * 100, 2)}%` }}
                              >
                                {m.deferred > 0 && (
                                  <span className="text-[10px] font-medium text-white">
                                    {formatINR(m.deferred)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>

                  {/* Summary table */}
                  <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b border-border">
                        <tr>
                          <th className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2">Month</th>
                          <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Recognized</th>
                          <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Deferred</th>
                          <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Entries</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {monthly.map((m: any) => (
                          <tr key={m.month} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono text-xs">{m.month}</td>
                            <td className="px-3 py-2 text-right font-medium text-emerald-600">{formatINR(m.recognized)}</td>
                            <td className="px-3 py-2 text-right font-medium text-amber-600">{formatINR(m.deferred)}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{m.entries}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </ContentCard>
            </>
          )}
        </>
      )}
    </div>
  )
}
