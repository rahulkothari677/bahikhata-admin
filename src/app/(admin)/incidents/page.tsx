'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertTriangle, Plus, Play, Pause, X, RefreshCw, Eye,
  TrendingUp, CheckCircle2, Loader2, Clock, Activity, Wrench, Zap,
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
  minor: 'neutral',
  major: 'warning',
  critical: 'danger',
  maintenance: 'info',
}

const STATUS_BADGE: Record<string, 'warning' | 'info' | 'success' | 'neutral'> = {
  investigating: 'warning',
  identified: 'info',
  monitoring: 'info',
  resolved: 'success',
}

const SERVICE_LABELS: Record<string, string> = {
  api: 'API & Web App',
  database: 'Database',
  ai_providers: 'AI Providers',
  payments: 'Payment Gateway',
  all: 'All Services',
}

export default function IncidentsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | string>('all')
  const [showEditor, setShowEditor] = useState(false)
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null)
  const [updateMessage, setUpdateMessage] = useState('')
  const [updateStatus, setUpdateStatus] = useState<string>('')

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-incidents-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/incidents?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 30 * 1000, // 30s (incidents need fresher data)
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-incidents-list', page, statusFilter, severityFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        status: statusFilter,
        severity: severityFilter,
      })
      const r = await fetch(`/api/admin/incidents?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ SINGLE INCIDENT (expanded detail) ============
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-incident-detail', expandedIncident],
    queryFn: async () => {
      const r = await fetch(`/api/admin/incidents/${expandedIncident}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: !!expandedIncident,
    staleTime: 15 * 1000,
  })

  // ============ CREATE MUTATION ============
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch('/api/admin/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || result.detail || `HTTP ${r.status}`)
      return result
    },
    onSuccess: () => {
      toast.success('Incident created')
      queryClient.invalidateQueries({ queryKey: ['admin-incidents-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-incidents-overview'] })
      setShowEditor(false)
    },
    onError: (err: Error) => {
      toast.error('Create failed', { description: err.message })
    },
  })

  // ============ UPDATE INCIDENT STATUS MUTATION ============
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const r = await fetch(`/api/admin/incidents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['admin-incidents-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-incidents-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-incident-detail'] })
    },
    onError: (err: Error) => {
      toast.error('Update failed', { description: err.message })
    },
  })

  // ============ ADD UPDATE MUTATION ============
  const addUpdateMutation = useMutation({
    mutationFn: async ({ id, message, status }: { id: string; message: string; status?: string }) => {
      const r = await fetch(`/api/admin/incidents/${id}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, status }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Update added')
      setUpdateMessage('')
      setUpdateStatus('')
      queryClient.invalidateQueries({ queryKey: ['admin-incident-detail'] })
      queryClient.invalidateQueries({ queryKey: ['admin-incidents-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-incidents-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Failed to add update', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const incidents = listData?.incidents || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Status Page Incidents"
        description="Manage incidents shown on the public /status page · investor + user trust signal"
        actions={
          <button
            onClick={() => setShowEditor(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Incident
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Incidents', icon: AlertTriangle },
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
              icon={AlertTriangle}
              title="Failed to load incidents"
              description="Please try refreshing"
            />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Active Incidents"
                  value={formatNumber(ov.activeCount || 0)}
                  icon={AlertTriangle}
                  iconColor="text-amber-600"
                  sublabel="Unresolved (any severity)"
                />
                <KPICard
                  label="Critical"
                  value={formatNumber(ov.criticalCount || 0)}
                  icon={Zap}
                  iconColor="text-red-600"
                  sublabel="Active critical incidents"
                />
                <KPICard
                  label="Maintenance"
                  value={formatNumber(ov.maintenanceCount || 0)}
                  icon={Wrench}
                  iconColor="text-blue-600"
                  sublabel="Scheduled maintenance"
                />
                <KPICard
                  label="Resolved (all time)"
                  value={formatNumber(ov.resolvedCount || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.recent7d || 0} new in last 7 days`}
                />
              </KPIGrid>

              {/* Public status page link */}
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  📊 <strong>Public Status Page:</strong>{' '}
                  <a
                    href="/status"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    /status
                  </a>
                  {' '}— accessible without login. Shows real-time service health + incident history to investors and users.
                </p>
              </div>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How incidents work (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Incident Lifecycle:</p>
                    <ul className="space-y-0.5">
                      <li>• Severity: minor → major → critical → maintenance</li>
                      <li>• Status: investigating → identified → monitoring → resolved</li>
                      <li>• Each status change creates a timeline update (audit trail)</li>
                      <li>• Resolved incidents move to history (visible on /status)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Public Visibility:</p>
                    <ul className="space-y-0.5">
                      <li>• /status page is PUBLIC (no auth required)</li>
                      <li>• Shows: overall status, 4 service checks, active incidents, history</li>
                      <li>• Cached for 60s (handles traffic spikes)</li>
                      <li>• Service checks: DB ping, AI provider config, payment config, API response</li>
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
              {['all', 'investigating', 'identified', 'monitoring', 'resolved'].map((s) => (
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
              {['all', 'minor', 'major', 'critical', 'maintenance'].map((s) => (
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
          </div>

          <ContentCard title={`Incidents — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : incidents.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No incidents found"
                description={statusFilter !== 'all' || severityFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "All systems operational! Click 'New Incident' to create one."}
              />
            ) : (
              <div className="divide-y divide-border">
                {incidents.map((inc: any) => (
                  <div key={inc.id}>
                    {/* Incident row */}
                    <button
                      onClick={() => setExpandedIncident(expandedIncident === inc.id ? null : inc.id)}
                      className="w-full text-left p-4 hover:bg-muted/30 transition"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                          inc.status === 'resolved' ? 'bg-emerald-500' :
                          inc.severity === 'critical' ? 'bg-red-500' :
                          inc.severity === 'major' ? 'bg-amber-500' :
                          inc.severity === 'maintenance' ? 'bg-blue-500' :
                          'bg-slate-400'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{inc.title}</p>
                            <Badge variant={SEVERITY_BADGE[inc.severity] || 'neutral'}>{inc.severity}</Badge>
                            <Badge variant={STATUS_BADGE[inc.status] || 'neutral'}>{inc.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{inc.description}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{SERVICE_LABELS[inc.service] || inc.service}</span>
                            <span>· Started {formatRelativeTime(inc.startedAt)}</span>
                            {inc.resolvedAt && <span>· Resolved {formatRelativeTime(inc.resolvedAt)}</span>}
                            <span>· {inc.updateCount} update(s)</span>
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {expandedIncident === inc.id && (
                      <div className="bg-muted/20 p-4 border-t border-border">
                        {detailLoading ? (
                          <LoadingSkeleton rows={4} />
                        ) : detailData?.incident ? (
                          <IncidentDetail
                            incident={detailData.incident}
                            updateMessage={updateMessage}
                            setUpdateMessage={setUpdateMessage}
                            updateStatus={updateStatus}
                            setUpdateStatus={setUpdateStatus}
                            onAddUpdate={() => {
                              if (!updateMessage.trim()) {
                                toast.error('Message is required')
                                return
                              }
                              addUpdateMutation.mutate({
                                id: inc.id,
                                message: updateMessage,
                                status: updateStatus || undefined,
                              })
                            }}
                            onStatusChange={(newStatus) =>
                              updateStatusMutation.mutate({ id: inc.id, status: newStatus })
                            }
                            actionLoading={addUpdateMutation.isPending || updateStatusMutation.isPending}
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">Failed to load details</p>
                        )}
                      </div>
                    )}
                  </div>
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
        <IncidentEditor
          onClose={() => setShowEditor(false)}
          onCreate={(data) => createMutation.mutate(data)}
          saving={createMutation.isPending}
        />
      )}
    </div>
  )
}

// =====================================================================
// INCIDENT DETAIL (expanded view)
// =====================================================================
function IncidentDetail({
  incident,
  updateMessage,
  setUpdateMessage,
  updateStatus,
  setUpdateStatus,
  onAddUpdate,
  onStatusChange,
  actionLoading,
}: {
  incident: any
  updateMessage: string
  setUpdateMessage: (v: string) => void
  updateStatus: string
  setUpdateStatus: (v: string) => void
  onAddUpdate: () => void
  onStatusChange: (status: string) => void
  actionLoading: boolean
}) {
  const updates = incident.updates || []

  return (
    <div className="space-y-4">
      {/* Quick status change buttons */}
      {incident.status !== 'resolved' && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Status Change</p>
          <div className="flex items-center gap-2 flex-wrap">
            {['investigating', 'identified', 'monitoring', 'resolved'].map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                disabled={actionLoading || incident.status === s}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                  incident.status === s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                } disabled:opacity-50`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add update */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Add Timeline Update</p>
        <textarea
          value={updateMessage}
          onChange={(e) => setUpdateMessage(e.target.value)}
          rows={3}
          placeholder="Provide an update on the incident..."
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-2"
        />
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground">Status (optional):</span>
          <select
            value={updateStatus}
            onChange={(e) => setUpdateStatus(e.target.value)}
            className="px-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">— No change —</option>
            <option value="investigating">Investigating</option>
            <option value="identified">Identified</option>
            <option value="monitoring">Monitoring</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <button
          onClick={onAddUpdate}
          disabled={actionLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Add Update
        </button>
      </div>

      {/* Timeline */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Timeline ({updates.length} updates)</p>
        {updates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No updates yet</p>
        ) : (
          <div className="space-y-3">
            {updates.map((u: any, i: number) => (
              <div key={u.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${
                    u.status === 'resolved' ? 'bg-emerald-500' :
                    u.status === 'monitoring' ? 'bg-blue-500' :
                    u.status === 'identified' ? 'bg-amber-500' :
                    'bg-red-500'
                  }`} />
                  {i < updates.length - 1 && <div className="w-px h-6 bg-border mt-1" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={STATUS_BADGE[u.status] || 'neutral'}>{u.status}</Badge>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(u.createdAt)}</span>
                  </div>
                  <p className="text-sm mt-0.5">{u.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// =====================================================================
// INCIDENT EDITOR MODAL
// =====================================================================
function IncidentEditor({
  onClose,
  onCreate,
  saving,
}: {
  onClose: () => void
  onCreate: (data: any) => void
  saving: boolean
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('minor')
  const [status, setStatus] = useState('investigating')
  const [service, setService] = useState('all')

  const handleSave = () => {
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required')
      return
    }
    onCreate({ title, description, severity, status, service })
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
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>New Incident</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Database connectivity issues"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What's happening? What's the impact?"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full px-2 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-2 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="investigating">Investigating</option>
                <option value="identified">Identified</option>
                <option value="monitoring">Monitoring</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Service</label>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="w-full px-2 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Services</option>
                <option value="api">API & Web App</option>
                <option value="database">Database</option>
                <option value="ai_providers">AI Providers</option>
                <option value="payments">Payment Gateway</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 sticky bottom-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Incident
          </button>
        </div>
      </div>
    </div>
  )
}
