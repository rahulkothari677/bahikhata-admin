'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ShieldAlert, Plus, RefreshCw, Loader2, X, Play,
  AlertTriangle, CheckCircle2, Eye, Ban, Zap, TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'rules' | 'alerts'

const PAGE_SIZE = 20

const SEVERITY_BADGE: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
}

const ALERT_STATUS_BADGE: Record<string, 'danger' | 'warning' | 'success' | 'neutral'> = {
  open: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
  false_positive: 'neutral',
}

const METRIC_LABELS: Record<string, string> = {
  transaction_count: 'Transaction Count',
  transaction_amount: 'Transaction Amount (₹)',
  ai_call_count: 'AI Call Count',
  login_failure_count: 'Login Failures (by IP)',
  new_user_with_activity: 'New User with High Activity',
}

const OPERATOR_LABELS: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
}

export default function FraudRulesPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [showEditor, setShowEditor] = useState(false)
  const [editingRule, setEditingRule] = useState<any>(null)
  const [alertPage, setAlertPage] = useState(1)
  const [alertStatus, setAlertStatus] = useState<'all' | 'open' | 'acknowledged' | 'resolved' | 'false_positive'>('all')
  const [alertSeverity, setAlertSeverity] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all')
  const [showNoteModal, setShowNoteModal] = useState<{ alertId: string; status: string } | null>(null)
  const [noteText, setNoteText] = useState('')

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-fraud-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/fraud-rules?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ RULES LIST ============
  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['admin-fraud-rules-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/fraud-rules?tab=list')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'rules',
    staleTime: 30 * 1000,
  })

  // ============ ALERTS LIST ============
  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['admin-fraud-alerts', alertPage, alertStatus, alertSeverity],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(alertPage),
        status: alertStatus,
        severity: alertSeverity,
      })
      const r = await fetch(`/api/admin/fraud-alerts?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'alerts',
    staleTime: 30 * 1000,
  })

  // ============ EVALUATE MUTATION ============
  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/fraud-rules/evaluate', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Evaluation complete — ${data.totalRules} rules checked in ${(data.durationMs / 1000).toFixed(1)}s`,
        { description: data.totalAlertsCreated > 0 ? `${data.totalAlertsCreated} new alert(s) created!` : 'No new alerts.' }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-rules-list'] })
    },
    onError: (err: Error) => {
      toast.error('Evaluation failed', { description: err.message })
    },
  })

  // ============ ALERT STATUS MUTATION ============
  const alertStatusMutation = useMutation({
    mutationFn: async ({ id, status, adminNote }: { id: string; status: string; adminNote?: string }) => {
      const r = await fetch(`/api/admin/fraud-alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNote }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Alert updated')
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-overview'] })
      setShowNoteModal(null)
      setNoteText('')
    },
    onError: (err: Error) => {
      toast.error('Update failed', { description: err.message })
    },
  })

  // ============ RULE TOGGLE MUTATION ============
  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const r = await fetch(`/api/admin/fraud-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Rule updated')
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-rules-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Toggle failed', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const rules = rulesData?.rules || []
  const alerts = alertsData?.alerts || []
  const alertTotal = alertsData?.total || 0
  const alertTotalPages = alertsData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Fraud Rules"
        description="Custom rules that auto-detect suspicious activity · bulk groupBy evaluation"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => evaluateMutation.mutate()}
              disabled={evaluateMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition disabled:opacity-50"
            >
              {evaluateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Evaluate Now
            </button>
            <button
              onClick={() => { setEditingRule(null); setShowEditor(true) }}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
            >
              <Plus className="w-4 h-4" />
              New Rule
            </button>
          </div>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'rules' as const, label: 'All Rules', icon: ShieldAlert },
          { id: 'alerts' as const, label: 'Fraud Alerts', icon: AlertTriangle },
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
            <EmptyState icon={AlertTriangle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Active Rules"
                  value={formatNumber(ov.enabledCount || 0)}
                  icon={ShieldAlert}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.disabledCount || 0} disabled`}
                />
                <KPICard
                  label="Open Alerts"
                  value={formatNumber(ov.openAlertCount || 0)}
                  icon={AlertTriangle}
                  iconColor="text-red-600"
                  sublabel="Needs investigation"
                />
                <KPICard
                  label="Critical Open"
                  value={formatNumber(ov.criticalOpenCount || 0)}
                  icon={Zap}
                  iconColor="text-red-600"
                  sublabel="High-priority alerts"
                />
                <KPICard
                  label="Total Rules"
                  value={formatNumber(ov.totalRules || 0)}
                  icon={ShieldAlert}
                  iconColor="text-violet-600"
                  sublabel="All rules (enabled + disabled)"
                />
              </KPIGrid>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How fraud rules work (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">5 Metric Types:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Transaction Count</strong>: too many txns in time window</li>
                      <li>• <strong>Transaction Amount</strong>: large ₹ amount in window</li>
                      <li>• <strong>AI Call Count</strong>: excessive AI usage (abuse)</li>
                      <li>• <strong>Login Failures (by IP)</strong>: brute force detection</li>
                      <li>• <strong>New User w/ Activity</strong>: bot account detection</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Evaluation Strategy:</p>
                    <ul className="space-y-0.5">
                      <li>• Uses bulk <code className="text-[11px] bg-muted px-1 rounded">groupBy</code> (not per-user queries)</li>
                      <li>• 10s timeout per rule (one failure doesn't stop others)</li>
                      <li>• Deduplication: skips if alert already open for user+rule</li>
                      <li>• 5-min cooldown between manual evaluations</li>
                      <li>• Production: should run via cron (every 15 min)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ RULES TAB ============ */}
      {tab === 'rules' && (
        <ContentCard title="All Fraud Rules">
          {rulesLoading ? (
            <LoadingSkeleton rows={6} />
          ) : rules.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No rules yet"
              description="Click 'New Rule' to create your first fraud detection rule"
            />
          ) : (
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Condition</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Window</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Severity</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase px-4 py-3">Enabled</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Open Alerts</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rules.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium">{r.name}</p>
                      {r.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-xs">{r.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {METRIC_LABELS[r.metric] || r.metric} {OPERATOR_LABELS[r.operator] || r.operator} {formatNumber(r.threshold)}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.windowMinutes
                        ? r.windowMinutes < 60 ? `${r.windowMinutes}m` : `${Math.round(r.windowMinutes / 60)}h`
                        : 'All-time'}
                      {r.userAgeMinutes && (
                        <span className="block text-[10px]">user age &lt; {r.userAgeMinutes < 60 ? `${r.userAgeMinutes}m` : `${Math.round(r.userAgeMinutes / 60)}h`}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={SEVERITY_BADGE[r.severity] || 'neutral'}>{r.severity}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleMutation.mutate({ id: r.id, enabled: !r.enabled })}
                        disabled={toggleMutation.isPending}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${r.enabled ? 'bg-emerald-500' : 'bg-muted'}`}
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${r.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.openAlertCount > 0 ? (
                        <Badge variant="danger">{r.openAlertCount}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { setEditingRule(r); setShowEditor(true) }}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ContentCard>
      )}

      {/* ============ ALERTS TAB ============ */}
      {tab === 'alerts' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Status:</span>
              {(['all', 'open', 'acknowledged', 'resolved', 'false_positive'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setAlertStatus(s); setAlertPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                    alertStatus === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Severity:</span>
              {(['all', 'low', 'medium', 'high', 'critical'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setAlertSeverity(s); setAlertPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                    alertSeverity === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <ContentCard title={`Fraud Alerts — ${alertTotal} total`}>
            {alertsLoading ? (
              <LoadingSkeleton rows={8} />
            ) : alerts.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No alerts found"
                description={alertStatus !== 'all' || alertSeverity !== 'all'
                  ? "Try adjusting filters"
                  : "Run 'Evaluate Now' to check rules against current data"}
              />
            ) : (
              <div className="divide-y divide-border">
                {alerts.map((a: any) => (
                  <div key={a.id} className="p-4 hover:bg-muted/30 transition">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className={`w-5 h-5 mt-1 flex-shrink-0 ${
                        a.ruleSeverity === 'critical' ? 'text-red-600' :
                        a.ruleSeverity === 'high' ? 'text-amber-600' :
                        'text-slate-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-medium">{a.ruleName}</p>
                          <Badge variant={SEVERITY_BADGE[a.ruleSeverity] || 'neutral'}>{a.ruleSeverity}</Badge>
                          <Badge variant={ALERT_STATUS_BADGE[a.status] || 'neutral'}>{a.status.replace('_', ' ')}</Badge>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">
                            Value: <strong className="text-foreground">{formatNumber(a.metricValue)}</strong>
                          </span>
                          <span className="text-xs text-muted-foreground">vs threshold: {formatNumber(a.threshold)}</span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(a.detectedAt)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>User:</span>
                          {a.userId.startsWith('cmd') || a.userId.length > 20 ? (
                            <Link href={`/users/${a.userId}`} className="hover:underline">
                              {a.userName || a.userEmail || a.userId.slice(0, 12) + '…'}
                            </Link>
                          ) : (
                            <span className="font-mono">{a.userId}</span>
                          )}
                          {a.userEmail && <span>· {a.userEmail}</span>}
                        </div>
                        {a.adminNote && (
                          <div className="mt-2 p-2 bg-muted/30 rounded text-xs text-muted-foreground">
                            <strong>Note:</strong> {a.adminNote}
                          </div>
                        )}
                        {/* Action buttons */}
                        {a.status === 'open' && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => alertStatusMutation.mutate({ id: a.id, status: 'acknowledged' })}
                              disabled={alertStatusMutation.isPending}
                              className="px-2.5 py-1 text-xs font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50"
                            >
                              Acknowledge
                            </button>
                            <button
                              onClick={() => setShowNoteModal({ alertId: a.id, status: 'resolved' })}
                              disabled={alertStatusMutation.isPending}
                              className="px-2.5 py-1 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
                            >
                              Resolve
                            </button>
                            <button
                              onClick={() => setShowNoteModal({ alertId: a.id, status: 'false_positive' })}
                              disabled={alertStatusMutation.isPending}
                              className="px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-md hover:bg-muted/70 disabled:opacity-50"
                            >
                              False Positive
                            </button>
                          </div>
                        )}
                        {a.status === 'acknowledged' && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => setShowNoteModal({ alertId: a.id, status: 'resolved' })}
                              disabled={alertStatusMutation.isPending}
                              className="px-2.5 py-1 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
                            >
                              Resolve
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ContentCard>

          {alertTotal > 0 && (
            <Pagination
              page={alertPage}
              totalPages={alertTotalPages}
              total={alertTotal}
              pageSize={PAGE_SIZE}
              onPageChange={setAlertPage}
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
              <h2 className="text-lg font-bold capitalize" style={{ color: '#0f172a' }}>
                {showNoteModal.status.replace('_', ' ')}
              </h2>
              <button
                onClick={() => { setShowNoteModal(null); setNoteText('') }}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Add a note explaining this resolution (e.g. "Investigated — legitimate bulk upload" or "Confirmed fraud — user banned").
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
                onClick={() => alertStatusMutation.mutate({
                  id: showNoteModal.alertId,
                  status: showNoteModal.status,
                  adminNote: noteText,
                })}
                disabled={alertStatusMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {alertStatusMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ RULE EDITOR MODAL ============ */}
      {showEditor && (
        <RuleEditor
          rule={editingRule}
          metricConfigs={overview?.metricConfigs || []}
          operatorConfigs={overview?.operatorConfigs || []}
          onClose={() => { setShowEditor(false); setEditingRule(null) }}
          onSaved={() => {
            setShowEditor(false)
            setEditingRule(null)
            queryClient.invalidateQueries({ queryKey: ['admin-fraud-rules-list'] })
            queryClient.invalidateQueries({ queryKey: ['admin-fraud-overview'] })
          }}
        />
      )}
    </div>
  )
}

// =====================================================================
// RULE EDITOR MODAL
// =====================================================================
function RuleEditor({
  rule,
  metricConfigs,
  operatorConfigs,
  onClose,
  onSaved,
}: {
  rule: any
  metricConfigs: any[]
  operatorConfigs: any[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(rule?.name || '')
  const [description, setDescription] = useState(rule?.description || '')
  const [metric, setMetric] = useState(rule?.metric || 'transaction_count')
  const [operator, setOperator] = useState(rule?.operator || 'gt')
  const [threshold, setThreshold] = useState(rule?.threshold?.toString() || '50')
  const [windowMinutes, setWindowMinutes] = useState(rule?.windowMinutes?.toString() || '60')
  const [userAgeMinutes, setUserAgeMinutes] = useState(rule?.userAgeMinutes?.toString() || '')
  const [severity, setSeverity] = useState(rule?.severity || 'medium')
  const [enabled, setEnabled] = useState(rule?.enabled !== false)

  const isEditing = !!rule
  const requiresUserAge = metric === 'new_user_with_activity'

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const url = isEditing ? `/api/admin/fraud-rules/${rule.id}` : '/api/admin/fraud-rules'
      const r = await fetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Rule updated' : 'Rule created')
      onSaved()
    },
    onError: (err: Error) => {
      toast.error('Save failed', { description: err.message })
    },
  })

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (requiresUserAge && !userAgeMinutes) {
      toast.error('userAgeMinutes is required for new_user_with_activity metric')
      return
    }

    saveMutation.mutate({
      name,
      description,
      metric,
      operator,
      threshold,
      windowMinutes: windowMinutes || null,
      userAgeMinutes: requiresUserAge ? userAgeMinutes : (userAgeMinutes || null),
      severity,
      enabled,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto z-[101]"
        style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>
            {isEditing ? 'Edit Rule' : 'New Fraud Rule'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Excessive Transactions (Bot Detection)"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What does this rule detect?"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Metric *</label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {metricConfigs.map((m: any) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {metricConfigs.find((m: any) => m.key === metric)?.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Operator *</label>
              <select
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {operatorConfigs.map((o: any) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Threshold *</label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                step="any"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Time Window (minutes)
              </label>
              <input
                type="number"
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(e.target.value)}
                placeholder="60 = 1 hour, 1440 = 24 hours"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">Empty = all-time</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                User Age (minutes) {requiresUserAge && '*'}
              </label>
              <input
                type="number"
                value={userAgeMinutes}
                onChange={(e) => setUserAgeMinutes(e.target.value)}
                placeholder="Only check users created within X min"
                disabled={!requiresUserAge && !userAgeMinutes}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
              {requiresUserAge && (
                <p className="text-[11px] text-red-600 mt-0.5">Required for this metric</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Enabled</label>
              <select
                value={enabled ? 'true' : 'false'}
                onChange={(e) => setEnabled(e.target.value === 'true')}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="true">Enabled (active)</option>
                <option value="false">Disabled (paused)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 sticky bottom-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isEditing ? 'Update Rule' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}
