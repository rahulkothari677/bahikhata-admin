'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Webhook, Plus, Edit3, Trash2, X, Save, Loader2, Send,
  TrendingUp, CheckCircle2, XCircle, Clock, AlertTriangle,
  RefreshCw, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'endpoints' | 'deliveries'

const PAGE_SIZE = 20

const STATUS_BADGE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  active: 'success',
  disabled: 'neutral',
}

const DELIVERY_STATUS_BADGE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  success: 'success',
  failed: 'danger',
  retrying: 'warning',
}

const DELIVERY_STATUS_ICON: Record<string, any> = {
  pending: Clock,
  success: CheckCircle2,
  failed: XCircle,
  retrying: RefreshCw,
}

export default function WebhooksPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<'all' | 'pending' | 'success' | 'failed' | 'retrying'>('all')
  const [showEditor, setShowEditor] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<any>(null)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-webhooks-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/webhooks?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 30 * 1000,
  })

  // ============ ENDPOINTS LIST ============
  const { data: endpointsData, isLoading: endpointsLoading } = useQuery({
    queryKey: ['admin-webhooks-list', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        status: statusFilter,
      })
      const r = await fetch(`/api/admin/webhooks?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'endpoints',
    staleTime: 30 * 1000,
  })

  // ============ DELIVERIES LIST ============
  const { data: deliveriesData, isLoading: deliveriesLoading } = useQuery({
    queryKey: ['admin-webhook-deliveries', page, deliveryStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        status: deliveryStatusFilter,
      })
      const r = await fetch(`/api/admin/webhooks/deliveries?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'deliveries',
    staleTime: 15 * 1000,
  })

  // ============ SAVE MUTATION ============
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const isEdit = !!data.id
      const url = isEdit ? `/api/admin/webhooks/${data.id}` : '/api/admin/webhooks'
      const r = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || result.detail || `HTTP ${r.status}`)
      return result
    },
    onSuccess: (data) => {
      toast.success('Webhook saved')
      if (data.secret) {
        toast.info('HMAC secret generated — check server logs (shown once)', { duration: 8000 })
      }
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks-overview'] })
      setShowEditor(false)
      setEditingEndpoint(null)
    },
    onError: (err: Error) => {
      toast.error('Save failed', { description: err.message })
    },
  })

  // ============ DELIVER NOW MUTATION ============
  const deliverMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/webhooks/deliver', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Processed ${data.processed} deliveries`,
        { description: `Success: ${data.succeeded} · Retrying: ${data.retrying} · Failed: ${data.failed}` }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-webhook-deliveries'] })
    },
    onError: (err: Error) => {
      toast.error('Delivery failed', { description: err.message })
    },
  })

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/webhooks/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Webhook deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Delete failed', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const eventConfigs = overview?.eventConfigs || []
  const endpoints = endpointsData?.endpoints || []
  const endpointsTotal = endpointsData?.total || 0
  const endpointsTotalPages = endpointsData?.totalPages || 0
  const deliveries = deliveriesData?.deliveries || []
  const deliveriesTotal = deliveriesData?.total || 0
  const deliveriesTotalPages = deliveriesData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Webhook Management"
        description="Partner webhook endpoints + delivery logs with retry · HMAC signed"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => deliverMutation.mutate()}
              disabled={deliverMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition disabled:opacity-50"
            >
              {deliverMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Deliver Now
            </button>
            <button
              onClick={() => { setEditingEndpoint(null); setShowEditor(true) }}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
            >
              <Plus className="w-4 h-4" />
              New Webhook
            </button>
          </div>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'endpoints' as const, label: 'Endpoints', icon: Webhook },
          { id: 'deliveries' as const, label: 'Delivery Logs', icon: Send },
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
                  label="Active Endpoints"
                  value={formatNumber(ov.activeCount || 0)}
                  icon={Webhook}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.disabledCount || 0} disabled`}
                />
                <KPICard
                  label="Total Delivered"
                  value={formatNumber(ov.totalSuccess || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.successRate || 0}% success rate`}
                />
                <KPICard
                  label="Failed"
                  value={formatNumber(ov.totalFailed || 0)}
                  icon={XCircle}
                  iconColor="text-red-600"
                  sublabel="After all retries"
                />
                <KPICard
                  label="Pending"
                  value={formatNumber(ov.pendingDeliveries || 0)}
                  icon={Clock}
                  iconColor="text-amber-600"
                  sublabel="Waiting to send or retry"
                />
              </KPIGrid>

              {/* Available events */}
              <ContentCard title="Available Webhook Events (6 types)">
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {eventConfigs.map((e: any) => (
                    <div key={e.key} className="p-3 bg-muted/30 rounded-lg border border-border">
                      <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{e.key}</code>
                      <p className="text-sm font-medium mt-1">{e.label}</p>
                      <p className="text-xs text-muted-foreground">{e.description}</p>
                    </div>
                  ))}
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How webhook delivery works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Delivery Flow:</p>
                    <ul className="space-y-0.5">
                      <li>• Event occurs (lead created, payment received, etc.)</li>
                      <li>• <code className="text-[11px] bg-muted px-1 rounded">dispatchEvent()</code> creates delivery records</li>
                      <li>• Background job sends via HTTP POST with HMAC signature</li>
                      <li>• 2xx response → success; non-2xx → retry with backoff</li>
                      <li>• Backoff: immediate → 1m → 5m → 25m (4 attempts max)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Security & Reliability:</p>
                    <ul className="space-y-0.5">
                      <li>• HMAC-SHA256 signature in <code className="text-[11px] bg-muted px-1 rounded">X-Webhook-Signature</code> header</li>
                      <li>• Partner verifies signature to prevent spoofing</li>
                      <li>• 10s timeout per delivery attempt</li>
                      <li>• Response body (first 1KB) stored for debugging</li>
                      <li>• Production: cron job runs every 1 minute</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ ENDPOINTS TAB ============ */}
      {tab === 'endpoints' && (
        <>
          <div className="flex items-center gap-2">
            {(['all', 'active', 'disabled'] as const).map((s) => (
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

          <ContentCard title={`Webhook Endpoints — ${endpointsTotal} total`}>
            {endpointsLoading ? (
              <LoadingSkeleton rows={6} />
            ) : endpoints.length === 0 ? (
              <EmptyState
                icon={Webhook}
                title="No webhook endpoints"
                description={statusFilter !== 'all' ? "Try a different filter" : "Click 'New Webhook' to add one"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">URL</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Partner</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Events</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Stats</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Last Sent</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {endpoints.map((e: any) => (
                    <tr key={e.id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-3">
                        <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded block max-w-xs truncate">
                          {e.url}
                        </code>
                        {e.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{e.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {e.partnerName || <span className="text-muted-foreground italic">—</span>}
                        {e.partnerType && (
                          <span className="block text-[10px] text-muted-foreground uppercase">{e.partnerType}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {e.events.map((ev: string) => (
                            <Badge key={ev} variant="neutral">{ev}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_BADGE[e.status] || 'neutral'}>{e.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="text-emerald-600">✓ {e.totalSuccess}</span>
                        <span className="mx-1">·</span>
                        <span className="text-red-600">✗ {e.totalFailed}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {e.lastSentAt ? formatRelativeTime(e.lastSentAt) : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditingEndpoint(e); setShowEditor(true) }}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Delete this webhook endpoint? All delivery logs will also be deleted.')) {
                                deleteMutation.mutate(e.id)
                              }
                            }}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600 transition"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ContentCard>

          {endpointsTotal > 0 && (
            <Pagination
              page={page}
              totalPages={endpointsTotalPages}
              total={endpointsTotal}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* ============ DELIVERIES TAB ============ */}
      {tab === 'deliveries' && (
        <>
          <div className="flex items-center gap-2">
            {(['all', 'pending', 'success', 'failed', 'retrying'] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setDeliveryStatusFilter(s); setPage(1) }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                  deliveryStatusFilter === s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <ContentCard title={`Delivery Logs — ${deliveriesTotal} total`}>
            {deliveriesLoading ? (
              <LoadingSkeleton rows={10} />
            ) : deliveries.length === 0 ? (
              <EmptyState
                icon={Send}
                title="No deliveries yet"
                description={deliveryStatusFilter !== 'all' ? "Try a different filter" : "Deliveries appear here when events are dispatched"}
              />
            ) : (
              <div className="divide-y divide-border">
                {deliveries.map((d: any) => {
                  const StatusIcon = DELIVERY_STATUS_ICON[d.status] || Clock
                  return (
                    <div key={d.id} className="p-4 hover:bg-muted/30 transition">
                      <div className="flex items-start gap-3">
                        <StatusIcon className={`w-4 h-4 mt-1 flex-shrink-0 ${
                          d.status === 'success' ? 'text-emerald-600' :
                          d.status === 'failed' ? 'text-red-600' :
                          'text-amber-600'
                        } ${d.status === 'retrying' ? 'animate-spin' : ''}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge variant={DELIVERY_STATUS_BADGE[d.status] || 'neutral'}>{d.status}</Badge>
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{d.eventType}</code>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">Attempt {d.attemptCount}/{d.maxAttempts}</span>
                            {d.responseStatus && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className={`text-xs font-medium ${d.responseStatus >= 200 && d.responseStatus < 300 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  HTTP {d.responseStatus}
                                </span>
                              </>
                            )}
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{formatRelativeTime(d.createdAt)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Endpoint: <code className="font-mono">{d.endpointUrl}</code>
                            {d.partnerName && <span> · {d.partnerName}</span>}
                          </div>
                          {d.errorMessage && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">⚠ {d.errorMessage}</p>
                          )}
                          {d.nextRetryAt && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                              ↻ Next retry: {formatRelativeTime(d.nextRetryAt)}
                            </p>
                          )}
                          {d.payload && (
                            <details className="mt-1">
                              <summary className="text-xs text-muted-foreground cursor-pointer hover:underline">
                                View payload
                              </summary>
                              <pre className="text-xs font-mono bg-muted/50 p-2 rounded mt-1 overflow-x-auto">
                                {d.payload}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ContentCard>

          {deliveriesTotal > 0 && (
            <Pagination
              page={page}
              totalPages={deliveriesTotalPages}
              total={deliveriesTotal}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* ============ EDITOR MODAL ============ */}
      {showEditor && (
        <WebhookEditor
          endpoint={editingEndpoint}
          eventConfigs={eventConfigs}
          onClose={() => { setShowEditor(false); setEditingEndpoint(null) }}
          onSave={(data) => {
            if (editingEndpoint) {
              saveMutation.mutate({ id: editingEndpoint.id, ...data })
            } else {
              saveMutation.mutate(data)
            }
          }}
          saving={saveMutation.isPending}
        />
      )}
    </div>
  )
}

// =====================================================================
// WEBHOOK EDITOR MODAL
// =====================================================================
function WebhookEditor({
  endpoint,
  eventConfigs,
  onClose,
  onSave,
  saving,
}: {
  endpoint: any
  eventConfigs: any[]
  onClose: () => void
  onSave: (data: any) => void
  saving: boolean
}) {
  const [partnerId, setPartnerId] = useState(endpoint?.partnerId || '')
  const [url, setUrl] = useState(endpoint?.url || '')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(endpoint?.events || [])
  const [description, setDescription] = useState(endpoint?.description || '')
  const [generateSecret, setGenerateSecret] = useState(!endpoint)
  const [status, setStatus] = useState(endpoint?.status || 'active')

  const isEditing = !!endpoint

  const handleEventToggle = (event: string) => {
    if (selectedEvents.includes(event)) {
      setSelectedEvents(selectedEvents.filter(e => e !== event))
    } else {
      setSelectedEvents([...selectedEvents, event])
    }
  }

  const handleSave = () => {
    if (!partnerId.trim()) {
      toast.error('Partner ID is required')
      return
    }
    if (!url.trim()) {
      toast.error('URL is required')
      return
    }
    try { new URL(url) } catch {
      toast.error('Invalid URL format')
      return
    }
    if (selectedEvents.length === 0) {
      toast.error('At least 1 event must be selected')
      return
    }

    onSave({
      partnerId,
      url,
      events: selectedEvents,
      description: description || null,
      ...(isEditing ? { status } : { generateSecret }),
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
            {isEditing ? 'Edit Webhook' : 'New Webhook'}
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
            <label className="text-xs font-medium text-muted-foreground block mb-1">Partner ID *</label>
            <input
              type="text"
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              placeholder="Paste partner ID from Partners page"
              disabled={isEditing}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">URL *</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://partner.com/webhooks/leads"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Where we POST event notifications. Must be HTTPS in production.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">Events to Subscribe *</label>
            <div className="space-y-2">
              {eventConfigs.map((e: any) => (
                <label
                  key={e.key}
                  className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${
                    selectedEvents.includes(e.key)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(e.key)}
                    onChange={() => handleEventToggle(e.key)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono">{e.key}</code>
                      <span className="text-sm font-medium">{e.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{e.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Production lead webhook"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {!isEditing && (
            <label className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg border border-border">
              <input
                type="checkbox"
                checked={generateSecret}
                onChange={(e) => setGenerateSecret(e.target.checked)}
              />
              <div>
                <p className="text-sm font-medium">Generate HMAC secret</p>
                <p className="text-xs text-muted-foreground">
                  Adds X-Webhook-Signature header (HMAC-SHA256) so partner can verify requests
                </p>
              </div>
            </label>
          )}

          {isEditing && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          )}
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
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEditing ? 'Update Webhook' : 'Create Webhook'}
          </button>
        </div>
      </div>
    </div>
  )
}
