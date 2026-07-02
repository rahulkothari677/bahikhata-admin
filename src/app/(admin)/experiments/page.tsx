'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  FlaskConical, Plus, Edit3, Trash2, X, Save, Loader2, Play,
  Pause, CheckCircle2, TrendingUp, Trophy, Users, Target,
  AlertCircle, BarChart3,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber, formatINR } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const STATUS_BADGE: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  running: 'warning',
  completed: 'success',
  cancelled: 'danger',
}

const METRIC_LABELS: Record<string, string> = {
  conversion: 'Conversion Rate',
  revenue: 'Revenue (₹)',
  retention: 'Retention Rate',
}

export default function ExperimentsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'running' | 'completed' | 'cancelled'>('all')
  const [showEditor, setShowEditor] = useState(false)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-experiments-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/experiments?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-experiments-list', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        status: statusFilter,
      })
      const r = await fetch(`/api/admin/experiments?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ STATUS CHANGE MUTATION ============
  const statusMutation = useMutation({
    mutationFn: async ({ id, status, conclusion }: { id: string; status: string; conclusion?: string }) => {
      const r = await fetch(`/api/admin/experiments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, conclusion }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success('Experiment updated')
      queryClient.invalidateQueries({ queryKey: ['admin-experiments-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-experiments-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Update failed', { description: err.message })
    },
  })

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/experiments/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Experiment deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-experiments-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-experiments-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Delete failed', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const experiments = listData?.experiments || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="A/B Testing"
        description="Experiment framework · control vs treatment · conversion tracking with statistical significance"
        actions={
          <button
            onClick={() => setShowEditor(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Experiment
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Experiments', icon: FlaskConical },
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
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Running Experiments"
                  value={formatNumber(ov.runningCount || 0)}
                  icon={Play}
                  iconColor="text-amber-600"
                  sublabel={`${ov.draftCount || 0} drafts pending`}
                />
                <KPICard
                  label="Completed"
                  value={formatNumber(ov.completedCount || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel="With results"
                />
                <KPICard
                  label="Total Assignments"
                  value={formatNumber(ov.totalAssignments || 0)}
                  icon={Users}
                  iconColor="text-blue-600"
                  sublabel="Users assigned to variants"
                />
                <KPICard
                  label="Total Experiments"
                  value={formatNumber(ov.totalCount || 0)}
                  icon={FlaskConical}
                  iconColor="text-violet-600"
                  sublabel="All time"
                />
              </KPIGrid>

              {/* Running experiments */}
              {overview.runningExperiments?.length > 0 && (
                <ContentCard title="Currently Running">
                  <div className="p-4 space-y-2">
                    {overview.runningExperiments.map((e: any) => (
                      <div key={e.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                        <div>
                          <p className="text-sm font-medium">{e.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {METRIC_LABELS[e.metric] || e.metric}
                            {e.targetEvent ? ` · ${e.targetEvent}` : ''}
                          </p>
                        </div>
                        <Badge variant="warning">running</Badge>
                      </div>
                    ))}
                  </div>
                </ContentCard>
              )}

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How A/B testing works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Experiment Lifecycle:</p>
                    <ul className="space-y-0.5">
                      <li>• Create experiment with control + 1+ treatment variants</li>
                      <li>• Variants have weights (must sum to 100)</li>
                      <li>• Set traffic % (e.g. 50% of users included)</li>
                      <li>• Start → users assigned deterministically (stable per user)</li>
                      <li>• Track conversions when users complete goal</li>
                      <li>• Complete → winner auto-determined (highest conversion rate)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Statistical Rigor:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Deterministic assignment:</strong> hash(userId + experimentId) → same user always gets same variant</li>
                      <li>• <strong>Minimum sample:</strong> 30 users per variant for significance</li>
                      <li>• <strong>Z-test for proportions:</strong> p-value &lt; 0.05 = significant</li>
                      <li>• 3 metric types: conversion, revenue, retention</li>
                      <li>• All queries wrapped in withTimeout + Neon retry</li>
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
          <div className="flex items-center gap-2">
            {(['all', 'draft', 'running', 'completed', 'cancelled'] as const).map((s) => (
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

          <ContentCard title={`Experiments — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={6} />
            ) : experiments.length === 0 ? (
              <EmptyState
                icon={FlaskConical}
                title="No experiments"
                description={statusFilter !== 'all' ? "Try a different filter" : "Click 'New Experiment' to create one"}
              />
            ) : (
              <div className="divide-y divide-border">
                {experiments.map((exp: any) => (
                  <ExperimentRow
                    key={exp.id}
                    experiment={exp}
                    onStatusChange={(status, conclusion) => statusMutation.mutate({ id: exp.id, status, conclusion })}
                    onDelete={() => {
                      if (confirm(`Delete experiment "${exp.name}"? All assignment data will be lost.`)) {
                        deleteMutation.mutate(exp.id)
                      }
                    }}
                    onEdit={() => setShowEditor(true)}
                  />
                ))}
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

      {/* ============ EDITOR MODAL ============ */}
      {showEditor && (
        <ExperimentEditor
          onClose={() => setShowEditor(false)}
          onCreated={() => {
            setShowEditor(false)
            queryClient.invalidateQueries({ queryKey: ['admin-experiments-list'] })
            queryClient.invalidateQueries({ queryKey: ['admin-experiments-overview'] })
            setTab('list')
          }}
        />
      )}
    </div>
  )
}

// =====================================================================
// EXPERIMENT ROW (with inline results)
// =====================================================================
function ExperimentRow({
  experiment,
  onStatusChange,
  onDelete,
  onEdit,
}: {
  experiment: any
  onStatusChange: (status: string, conclusion?: string) => void
  onDelete: () => void
  onEdit: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const results = experiment.results

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-muted/30 transition"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-sm font-medium">{experiment.name}</p>
              <Badge variant={STATUS_BADGE[experiment.status] || 'neutral'}>{experiment.status}</Badge>
              <Badge variant="info">{METRIC_LABELS[experiment.metric] || experiment.metric}</Badge>
              {experiment.winnerVariant && (
                <Badge variant="success">
                  <Trophy className="w-3 h-3 inline mr-1" />
                  Winner: {experiment.winnerVariant}
                </Badge>
              )}
            </div>
            {experiment.description && (
              <p className="text-xs text-muted-foreground mb-1">{experiment.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{experiment.variants.length} variants</span>
              <span>· {experiment.trafficPct}% traffic</span>
              <span>· {experiment.assignmentCount} assigned</span>
              <span>· Created {formatRelativeTime(experiment.createdAt)}</span>
            </div>
          </div>
        </div>
      </button>

      {/* Expanded results */}
      {expanded && results && (
        <div className="bg-muted/20 p-4 border-t border-border">
          {results.variants.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Results</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {results.variants.map((v: any) => {
                  const isWinner = results.winnerVariant === v.key
                  return (
                    <div
                      key={v.key}
                      className={`p-3 rounded-lg border ${isWinner ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-background'}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium">{v.name}</p>
                          <code className="text-[10px] font-mono text-muted-foreground">{v.key}</code>
                        </div>
                        {isWinner && <Trophy className="w-4 h-4 text-emerald-600" />}
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Assigned:</span>
                          <span className="font-medium">{v.assigned}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Converted:</span>
                          <span className="font-medium">{v.converted}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Conversion Rate:</span>
                          <span className="font-bold text-emerald-600">{v.conversionRate}%</span>
                        </div>
                        {experiment.metric === 'revenue' && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Total Revenue:</span>
                              <span className="font-medium">{formatINR(v.totalValue)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Avg Revenue/User:</span>
                              <span className="font-medium">{formatINR(v.avgValue)}</span>
                            </div>
                          </>
                        )}
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${isWinner ? 'bg-emerald-500' : 'bg-blue-500'} transition-all`}
                          style={{ width: `${v.conversionRate}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Significance note */}
              {!results.hasSignificantResult && results.status === 'running' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠ Need at least 30 users per variant for statistical significance.
                  Current: {Math.min(...results.variants.map((v: any) => v.assigned))} users in smallest variant.
                </p>
              )}
              {results.hasSignificantResult && results.winnerVariant && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ Statistically significant result. Winner: {results.winnerVariant}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No assignment data yet.</p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4">
            {experiment.status === 'draft' && (
              <button
                onClick={() => onStatusChange('running')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600"
              >
                <Play className="w-3 h-3" />
                Start Experiment
              </button>
            )}
            {experiment.status === 'running' && (
              <>
                <button
                  onClick={() => {
                    const conclusion = prompt('Enter conclusion (optional):') || undefined
                    onStatusChange('completed', conclusion)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Complete & Pick Winner
                </button>
                <button
                  onClick={() => onStatusChange('cancelled')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded-md hover:bg-red-600"
                >
                  <Pause className="w-3 h-3" />
                  Cancel
                </button>
              </>
            )}
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground rounded-md hover:bg-muted/80 ml-auto"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// EXPERIMENT EDITOR MODAL
// =====================================================================
function ExperimentEditor({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [metric, setMetric] = useState('conversion')
  const [metricGoal, setMetricGoal] = useState('increase')
  const [targetEvent, setTargetEvent] = useState('')
  const [trafficPct, setTrafficPct] = useState('100')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [variants, setVariants] = useState([
    { key: 'control', name: 'Default', weight: 50 },
    { key: 'treatment_a', name: 'Variation A', weight: 50 },
  ])

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await fetch('/api/admin/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Experiment created')
      onCreated()
    },
    onError: (err: Error) => {
      toast.error('Create failed', { description: err.message })
    },
  })

  const handleAddVariant = () => {
    const count = variants.length
    const newKey = `treatment_${String.fromCharCode(97 + count - 1)}` // treatment_a, treatment_b, ...
    setVariants([...variants, { key: newKey, name: `Variation ${String.fromCharCode(65 + count - 1)}`, weight: 0 }])
  }

  const handleRemoveVariant = (i: number) => {
    if (variants.length <= 2) return
    if (variants[i].key === 'control') return // can't remove control
    setVariants(variants.filter((_, idx) => idx !== i))
  }

  const handleVariantChange = (i: number, field: 'key' | 'name' | 'weight', value: string) => {
    const updated = [...variants]
    updated[i] = { ...updated[i], [field]: field === 'weight' ? parseInt(value, 10) || 0 : value }
    setVariants(updated)
  }

  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (totalWeight !== 100) {
      toast.error(`Variant weights must sum to 100 (current: ${totalWeight})`)
      return
    }

    createMutation.mutate({
      name,
      description,
      metric,
      metricGoal,
      targetEvent: targetEvent || null,
      trafficPct: parseInt(trafficPct, 10),
      variants,
      startAt: startAt || null,
      endAt: endAt || null,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto z-[101]"
        style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>New Experiment</h2>
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
              placeholder="e.g. Pricing Page Redesign"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What hypothesis are you testing?"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Metric *</label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="conversion">Conversion Rate</option>
                <option value="revenue">Revenue (₹)</option>
                <option value="retention">Retention Rate</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Goal</label>
              <select
                value={metricGoal}
                onChange={(e) => setMetricGoal(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="increase">Increase</option>
                <option value="decrease">Decrease</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Target Event</label>
              <input
                type="text"
                value={targetEvent}
                onChange={(e) => setTargetEvent(e.target.value)}
                placeholder="e.g. signup, payment, day7_retention"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Traffic %</label>
              <input
                type="number"
                value={trafficPct}
                onChange={(e) => setTrafficPct(e.target.value)}
                min="1"
                max="100"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Start At</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">End At</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* Variants */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">
                Variants * (weights must sum to 100, current: {totalWeight})
              </label>
              <button
                onClick={handleAddVariant}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                <Plus className="w-3 h-3" />
                Add Variant
              </button>
            </div>
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center p-2 bg-muted/30 rounded border border-border">
                  <div className="col-span-4">
                    <input
                      type="text"
                      value={v.key}
                      onChange={(e) => handleVariantChange(i, 'key', e.target.value)}
                      disabled={v.key === 'control'}
                      placeholder="variant_key"
                      className="w-full px-2 py-1 bg-background border border-border rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    />
                  </div>
                  <div className="col-span-5">
                    <input
                      type="text"
                      value={v.name}
                      onChange={(e) => handleVariantChange(i, 'name', e.target.value)}
                      placeholder="Display name"
                      className="w-full px-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={v.weight}
                      onChange={(e) => handleVariantChange(i, 'weight', e.target.value)}
                      min="0"
                      max="100"
                      placeholder="weight"
                      className="w-full px-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="col-span-1">
                    {v.key !== 'control' && variants.length > 2 && (
                      <button
                        onClick={() => handleRemoveVariant(i)}
                        className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded"
                        title="Remove variant"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
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
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Create Experiment
          </button>
        </div>
      </div>
    </div>
  )
}
