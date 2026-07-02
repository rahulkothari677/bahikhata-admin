'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertTriangle, TrendingUp, TrendingDown, RefreshCw, Loader2,
  CheckCircle2, Eye, Zap, Activity, AlertCircle, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const SEVERITY_BADGE: Record<string, 'neutral' | 'warning' | 'danger' | 'info'> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
}

const STATUS_BADGE: Record<string, 'danger' | 'warning' | 'success'> = {
  open: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
}

const DIRECTION_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  spike: { icon: TrendingUp, color: 'text-red-600', label: 'Spike' },
  drop: { icon: TrendingDown, color: 'text-blue-600', label: 'Drop' },
}

export default function AnomaliesPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'acknowledged' | 'resolved'>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all')
  const [metricFilter, setMetricFilter] = useState<string>('all')
  const [showNoteModal, setShowNoteModal] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-anomalies-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/anomalies?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-anomalies-list', page, statusFilter, severityFilter, metricFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        status: statusFilter,
        severity: severityFilter,
        metric: metricFilter,
      })
      const r = await fetch(`/api/admin/anomalies?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ DETECT MUTATION ============
  const detectMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/anomalies/detect', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Detection complete — ${data.totalMetricsChecked} metrics checked in ${(data.durationMs / 1000).toFixed(1)}s`,
        { description: data.newAnomalies > 0 ? `${data.newAnomalies} new anomaly(s) detected!` : 'No new anomalies.' }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-anomalies-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-anomalies-list'] })
    },
    onError: (err: Error) => {
      toast.error('Detection failed', { description: err.message })
    },
  })

  // ============ COOLDOWN POLL ============
  const { data: cooldownData } = useQuery({
    queryKey: ['admin-anomaly-detect-cooldown'],
    queryFn: async () => {
      const r = await fetch('/api/admin/anomalies/detect')
      if (!r.ok) return { canDetect: true, cooldownRemainingSeconds: 0 }
      return r.json()
    },
    refetchInterval: detectMutation.isPending ? 1000 : false,
    staleTime: 10 * 1000,
  })

  // ============ STATUS CHANGE MUTATION ============
  const statusMutation = useMutation({
    mutationFn: async ({ id, status, adminNote }: { id: string; status: string; adminNote?: string }) => {
      const r = await fetch(`/api/admin/anomalies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNote }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Anomaly updated')
      queryClient.invalidateQueries({ queryKey: ['admin-anomalies-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-anomalies-overview'] })
      setShowNoteModal(null)
      setNoteText('')
    },
    onError: (err: Error) => {
      toast.error('Update failed', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const metricDist = overview?.metricDistribution || []
  const trackedMetrics = overview?.trackedMetrics || []
  const anomalies = listData?.anomalies || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Anomaly Detection"
        description="Auto-detect metric spikes/drops using z-score statistics · 30-day baseline"
        actions={
          <button
            onClick={() => detectMutation.mutate()}
            disabled={detectMutation.isPending || (cooldownData && !cooldownData.canDetect)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {detectMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Detecting...
              </>
            ) : cooldownData && !cooldownData.canDetect ? (
              <>
                <RefreshCw className="w-4 h-4" />
                Cooldown {cooldownData.cooldownRemainingSeconds}s
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Run Detection
              </>
            )}
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Anomalies', icon: AlertTriangle },
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
          ) : !overview?.success ? (
            <EmptyState
              icon={AlertCircle}
              title="Failed to load anomalies"
              description="Please try refreshing"
            />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Open Anomalies"
                  value={formatNumber(ov.openCount || 0)}
                  icon={AlertTriangle}
                  iconColor="text-red-600"
                  sublabel={`${ov.criticalOpenCount || 0} critical · ${ov.recent24h || 0} detected in 24h`}
                />
                <KPICard
                  label="Acknowledged"
                  value={formatNumber(ov.acknowledgedCount || 0)}
                  icon={Eye}
                  iconColor="text-amber-600"
                  sublabel="Reviewed by admin"
                />
                <KPICard
                  label="Resolved"
                  value={formatNumber(ov.resolvedCount || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel="Fixed or false-positive"
                />
                <KPICard
                  label="Total Detected"
                  value={formatNumber(ov.totalCount || 0)}
                  icon={Activity}
                  iconColor="text-violet-600"
                  sublabel="All time"
                />
              </KPIGrid>

              {/* Open anomalies by metric */}
              <ContentCard title="Open Anomalies by Metric">
                {metricDist.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No open anomalies"
                    description="All clear! Run detection to check for new anomalies."
                  />
                ) : (
                  <div className="p-4 space-y-2">
                    {metricDist.map((m: any) => (
                      <div key={m.metric} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded">
                        <span className="text-sm font-medium">{m.metric.replace(/_/g, ' ')}</span>
                        <Badge variant="danger">{m.count} open</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ContentCard>

              {/* Tracked metrics */}
              <ContentCard title="Tracked Metrics (7 metrics)">
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {trackedMetrics.map((m: any) => (
                    <div key={m.key} className="p-3 bg-muted/30 rounded-lg border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{m.label}</p>
                        <Badge variant={m.higherIsBetter ? 'success' : 'warning'}>
                          {m.higherIsBetter ? '↑ Good' : '↓ Good'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{m.description}</p>
                    </div>
                  ))}
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How anomaly detection works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Z-Score Statistics:</p>
                    <ul className="space-y-0.5">
                      <li>• Baseline: last 30 days of daily values per metric</li>
                      <li>• Compute mean (μ) and standard deviation (σ)</li>
                      <li>• Z-score = (current - μ) / σ</li>
                      <li>• Anomaly if |z| &gt; 2.5 (statistically significant)</li>
                      <li>• Severity: low (2.5-3), medium (3-4), high (4-5), critical (5+)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Detection Strategy:</p>
                    <ul className="space-y-0.5">
                      <li>• 7 metrics tracked: signups, revenue, AI cost, AI calls, failed logins, transactions, support tickets</li>
                      <li>• Deduplication: skips if same metric already open in last 24h</li>
                      <li>• Cooldown: 5 min between manual detections</li>
                      <li>• Production: should run via daily cron (e.g. 2 AM IST)</li>
                      <li>• All queries wrapped in <code className="text-[11px] bg-muted px-1 rounded">withTimeout(10s)</code></li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ LIST TAB ============ */}
      {tab === 'list' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Status:</span>
              {(['all', 'open', 'acknowledged', 'resolved'] as const).map((s) => (
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Severity:</span>
              {(['all', 'low', 'medium', 'high', 'critical'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSeverityFilter(s); setPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                    severityFilter === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {trackedMetrics.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Metric:</span>
                <select
                  value={metricFilter}
                  onChange={(e) => { setMetricFilter(e.target.value); setPage(1) }}
                  className="px-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Metrics</option>
                  {trackedMetrics.map((m: any) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <ContentCard title={`Anomalies — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : anomalies.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No anomalies found"
                description={statusFilter !== 'all' || severityFilter !== 'all' || metricFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "Run detection to check for anomalies"}
              />
            ) : (
              <div className="divide-y divide-border">
                {anomalies.map((a: any) => {
                  const dirCfg = DIRECTION_CONFIG[a.direction] || DIRECTION_CONFIG.spike
                  const DirIcon = dirCfg.icon
                  return (
                    <div key={a.id} className="p-4 hover:bg-muted/30 transition">
                      <div className="flex items-start gap-3">
                        <DirIcon className={`w-5 h-5 mt-1 flex-shrink-0 ${dirCfg.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-sm font-medium">{a.metricLabel}</p>
                            <Badge variant={SEVERITY_BADGE[a.severity] || 'neutral'}>{a.severity}</Badge>
                            <Badge variant={STATUS_BADGE[a.status] || 'neutral'}>{a.status}</Badge>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className={`text-xs font-medium ${dirCfg.color}`}>{dirCfg.label}</span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">z-score: {a.zScore}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                            <span>Current: <strong className="text-foreground">{formatNumber(a.currentValue)}</strong></span>
                            <span>Baseline: <strong className="text-foreground">{formatNumber(a.baselineValue)}</strong></span>
                            <span>Std Dev: <strong className="text-foreground">{formatNumber(a.baselineStdDev)}</strong></span>
                            <span>· Detected {formatRelativeTime(a.detectedAt)}</span>
                          </div>
                          {a.adminNote && (
                            <div className="p-2 bg-muted/30 rounded text-xs text-muted-foreground mt-1">
                              <strong>Note:</strong> {a.adminNote}
                            </div>
                          )}
                          {/* Action buttons */}
                          {a.status !== 'resolved' && (
                            <div className="flex items-center gap-2 mt-2">
                              {a.status === 'open' && (
                                <button
                                  onClick={() => statusMutation.mutate({ id: a.id, status: 'acknowledged' })}
                                  disabled={statusMutation.isPending}
                                  className="px-2.5 py-1 text-xs font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50"
                                >
                                  Acknowledge
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setShowNoteModal(a.id)
                                  setNoteText('')
                                }}
                                disabled={statusMutation.isPending}
                                className="px-2.5 py-1 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
                              >
                                Resolve with Note
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ContentCard>

          {total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* ============ NOTE MODAL ============ */}
      {showNoteModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-md z-[101]"
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200" style={{ backgroundColor: '#ffffff' }}>
              <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>Resolve Anomaly</h2>
              <button
                onClick={() => { setShowNoteModal(null); setNoteText('') }}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Add a note explaining how this anomaly was resolved (e.g. "Fixed by restarting the AI provider" or "False positive — expected surge due to marketing campaign").
              </p>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={4}
                placeholder="Resolution note..."
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200" style={{ backgroundColor: '#ffffff' }}>
              <button
                onClick={() => { setShowNoteModal(null); setNoteText('') }}
                className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80"
              >
                Cancel
              </button>
              <button
                onClick={() => statusMutation.mutate({ id: showNoteModal, status: 'resolved', adminNote: noteText })}
                disabled={statusMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50"
              >
                {statusMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
