'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Megaphone, Plus, Play, Pause, X, RefreshCw, Eye,
  TrendingUp, AlertCircle, Clock, CheckCircle2, Loader2,
  ChevronDown, ChevronRight, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const STATUS_BADGE: Record<string, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  draft: 'neutral',
  scheduled: 'info',
  running: 'warning',
  paused: 'neutral',
  completed: 'success',
  cancelled: 'danger',
}

const STEP_STATUS_BADGE: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = {
  pending: 'neutral',
  running: 'warning',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
}

export default function CampaignsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all')
  const [showEditor, setShowEditor] = useState(false)
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-campaigns-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/campaigns?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-campaigns-list', page, search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        status: statusFilter,
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/campaigns?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ SINGLE CAMPAIGN (for expanded detail) ============
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-campaign-detail', expandedCampaign],
    queryFn: async () => {
      const r = await fetch(`/api/admin/campaigns/${expandedCampaign}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: !!expandedCampaign,
    staleTime: 30 * 1000,
  })

  // ============ ACTION MUTATION ============
  const actionMutation = useMutation({
    mutationFn: async ({ campaignId, action, stepId }: { campaignId: string; action: string; stepId?: string }) => {
      const r = await fetch(`/api/admin/campaigns/${campaignId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, stepId }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Action completed', {
        description: data.stats ? `Sent: ${data.stats.sentCount} · Failed: ${data.stats.failedCount} · Skipped: ${data.stats.skippedCount}` : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['admin-campaigns-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-campaigns-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-campaign-detail'] })
    },
    onError: (err: Error) => {
      toast.error('Action failed', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const campaigns = listData?.campaigns || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Campaigns"
        description="Multi-step notification sequences (e.g. Day 0: Welcome SMS → Day 3: Tips Email → Day 7: Discount Push)"
        actions={
          <button
            onClick={() => setShowEditor(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Campaign
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Campaigns', icon: Megaphone },
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
              title="Failed to load campaigns"
              description="Please try refreshing"
            />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Active Campaigns"
                  value={formatNumber(ov.activeCount || 0)}
                  icon={Play}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.runningCount || 0} running · ${ov.scheduledCount || 0} scheduled`}
                />
                <KPICard
                  label="Drafts"
                  value={formatNumber(ov.draftCount || 0)}
                  icon={Clock}
                  iconColor="text-amber-600"
                  sublabel="Not yet scheduled"
                />
                <KPICard
                  label="Completed"
                  value={formatNumber(ov.completedCount || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel="All steps finished"
                />
                <KPICard
                  label="Notifications Sent"
                  value={formatNumber(ov.totalNotificationsSent || 0)}
                  icon={Send}
                  iconColor="text-violet-600"
                  sublabel="Across all campaigns"
                />
              </KPIGrid>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How campaigns work (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Multi-Step Sequences:</p>
                    <ul className="space-y-0.5">
                      <li>• Each campaign has 1+ steps, each using a notification template</li>
                      <li>• Step delays in minutes after campaign start (0 = immediate, 4320 = 3 days)</li>
                      <li>• Variables auto-substituted per user (userName, plan, etc.)</li>
                      <li>• Target: segment ID (uses UserSegmentCache) or manual user ID list</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Lifecycle & Safety:</p>
                    <ul className="space-y-0.5">
                      <li>• Status: draft → scheduled → running → completed | paused | cancelled</li>
                      <li>• Actions: start, pause, resume, cancel, run-step (manual trigger)</li>
                      <li>• Max 1000 recipients per synchronous step (production: background job)</li>
                      <li>• Every send logged to NotificationLog + AdminAction audit trail</li>
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
            <div className="flex-1 min-w-[200px]">
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setPage(1) }}
                placeholder="Search by name or description..."
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {['all', 'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'].map((s) => (
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
          </div>

          <ContentCard title={`Campaigns — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : campaigns.length === 0 ? (
              <EmptyState
                icon={Megaphone}
                title="No campaigns found"
                description={search || statusFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "Click 'New Campaign' to create your first campaign"}
              />
            ) : (
              <div className="divide-y divide-border">
                {campaigns.map((c: any) => (
                  <div key={c.id}>
                    {/* Campaign row */}
                    <button
                      onClick={() => setExpandedCampaign(expandedCampaign === c.id ? null : c.id)}
                      className="w-full text-left p-4 hover:bg-muted/30 transition flex items-center gap-3"
                    >
                      {expandedCampaign === c.id ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{c.name}</p>
                          <Badge variant={STATUS_BADGE[c.status] || 'neutral'}>{c.status}</Badge>
                          <span className="text-xs text-muted-foreground">{c.stepCount} step(s)</span>
                        </div>
                        {c.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>Recipients: {c.totalRecipients}</span>
                          <span className="text-emerald-600">Sent: {c.totalSent}</span>
                          {c.totalFailed > 0 && <span className="text-red-600">Failed: {c.totalFailed}</span>}
                          {c.totalSkipped > 0 && <span className="text-amber-600">Skipped: {c.totalSkipped}</span>}
                          {c.startAt && <span>· Started {formatRelativeTime(c.startAt)}</span>}
                        </div>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {expandedCampaign === c.id && (
                      <div className="bg-muted/20 p-4 border-t border-border">
                        {detailLoading ? (
                          <LoadingSkeleton rows={4} />
                        ) : detailData?.campaign ? (
                          <CampaignDetail
                            campaign={detailData.campaign}
                            onAction={(action, stepId) =>
                              actionMutation.mutate({ campaignId: c.id, action, stepId })
                            }
                            actionLoading={actionMutation.isPending}
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
        <CampaignEditor
          onClose={() => setShowEditor(false)}
          onCreated={() => {
            setShowEditor(false)
            queryClient.invalidateQueries({ queryKey: ['admin-campaigns-list'] })
            queryClient.invalidateQueries({ queryKey: ['admin-campaigns-overview'] })
            setTab('list')
          }}
        />
      )}
    </div>
  )
}

// =====================================================================
// CAMPAIGN DETAIL (expanded view)
// =====================================================================
function CampaignDetail({
  campaign,
  onAction,
  actionLoading,
}: {
  campaign: any
  onAction: (action: string, stepId?: string) => void
  actionLoading: boolean
}) {
  const steps = campaign.steps || []

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {campaign.status === 'draft' && (
          <button
            onClick={() => onAction('start')}
            disabled={actionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
          >
            <Play className="w-3 h-3" />
            Start Campaign
          </button>
        )}
        {campaign.status === 'scheduled' && (
          <button
            onClick={() => onAction('start')}
            disabled={actionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
          >
            <Play className="w-3 h-3" />
            Start Now
          </button>
        )}
        {campaign.status === 'running' && (
          <>
            <button
              onClick={() => onAction('pause')}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50"
            >
              <Pause className="w-3 h-3" />
              Pause
            </button>
            <button
              onClick={() => {
                if (confirm('Cancel this campaign? Pending steps will be skipped.')) onAction('cancel')
              }}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          </>
        )}
        {campaign.status === 'paused' && (
          <>
            <button
              onClick={() => onAction('resume')}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
            >
              <Play className="w-3 h-3" />
              Resume
            </button>
            <button
              onClick={() => {
                if (confirm('Cancel this campaign?')) onAction('cancel')
              }}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Steps timeline */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Steps</p>
        <div className="space-y-3">
          {steps.map((step: any, i: number) => (
            <div key={step.id} className="flex items-start gap-3 p-3 bg-background rounded-lg border border-border">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  step.status === 'sent' ? 'bg-emerald-100 text-emerald-700' :
                  step.status === 'running' ? 'bg-amber-100 text-amber-700' :
                  step.status === 'failed' ? 'bg-red-100 text-red-700' :
                  step.status === 'skipped' ? 'bg-muted text-muted-foreground' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {step.stepNumber}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px h-8 bg-border mt-1" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{step.templateName || 'Unknown template'}</p>
                  <Badge variant={STEP_STATUS_BADGE[step.status] || 'neutral'}>{step.status}</Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>Delay: {step.delayMinutes === 0 ? 'Immediate' : step.delayMinutes < 1440 ? `${Math.round(step.delayMinutes / 60)}h` : `${Math.round(step.delayMinutes / 1440)}d`}</span>
                  {step.scheduledAt && <span>· Scheduled: {formatRelativeTime(step.scheduledAt)}</span>}
                  {step.sentAt && <span>· Sent: {formatRelativeTime(step.sentAt)}</span>}
                </div>
                {step.status === 'sent' && (
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    <span className="text-emerald-600">Sent: {step.sentCount}</span>
                    {step.failedCount > 0 && <span className="text-red-600">Failed: {step.failedCount}</span>}
                    {step.skippedCount > 0 && <span className="text-amber-600">Skipped: {step.skippedCount}</span>}
                  </div>
                )}
                {step.errorMessage && (
                  <p className="text-xs text-red-600 mt-1">{step.errorMessage}</p>
                )}
              </div>
              {/* Manual run button */}
              {step.status === 'pending' && (
                <button
                  onClick={() => onAction('run-step', step.id)}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  title="Manually trigger this step now"
                >
                  <Send className="w-3 h-3" />
                  Run Now
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// CAMPAIGN EDITOR MODAL
// =====================================================================
function CampaignEditor({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetSegmentId, setTargetSegmentId] = useState('')
  const [targetUserIds, setTargetUserIds] = useState('')
  const [startAt, setStartAt] = useState('')
  const [steps, setSteps] = useState<Array<{ templateId: string; delayMinutes: number }>>([
    { templateId: '', delayMinutes: 0 },
  ])

  const { data: templatesData } = useQuery({
    queryKey: ['admin-active-templates-for-campaign'],
    queryFn: async () => {
      const r = await fetch('/api/admin/notifications/templates')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
  })
  const templates = templatesData?.templates || []

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Campaign created')
      onCreated()
    },
    onError: (err: Error) => {
      toast.error('Create failed', { description: err.message })
    },
  })

  const handleAddStep = () => {
    setSteps([...steps, { templateId: '', delayMinutes: 10080 }]) // default 7 days
  }

  const handleRemoveStep = (i: number) => {
    if (steps.length === 1) return
    setSteps(steps.filter((_, idx) => idx !== i))
  }

  const handleStepChange = (i: number, field: 'templateId' | 'delayMinutes', value: string) => {
    const updated = [...steps]
    updated[i] = { ...updated[i], [field]: field === 'delayMinutes' ? parseInt(value, 10) || 0 : value }
    setSteps(updated)
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (steps.some(s => !s.templateId)) {
      toast.error('All steps must have a template selected')
      return
    }
    if (!targetSegmentId && !targetUserIds.trim()) {
      toast.error('Either select a segment or enter user IDs')
      return
    }

    const userIds = targetUserIds
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)

    createMutation.mutate({
      name,
      description,
      targetSegmentId: targetSegmentId || null,
      targetUserIds: targetSegmentId ? [] : userIds,
      startAt: startAt || null,
      steps,
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
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>New Campaign</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Onboarding Drip Campaign"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What does this campaign do?"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Target audience */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Target Audience *</label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Use a segment (pre-computed) OR enter user IDs manually (one per line).
            </p>
            <input
              type="text"
              value={targetSegmentId}
              onChange={(e) => setTargetSegmentId(e.target.value)}
              placeholder="Segment ID (e.g. power_users, at_risk) — leave empty to use user IDs"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-2"
            />
            {!targetSegmentId && (
              <textarea
                value={targetUserIds}
                onChange={(e) => setTargetUserIds(e.target.value)}
                rows={3}
                placeholder={'User IDs (one per line):\ncmd1abc2def3\ncmd2jkl3mno4'}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
            )}
          </div>

          {/* Start At */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Start At (optional)</label>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Leave empty to save as draft. Set a future time to schedule. Set a past time to start immediately.
            </p>
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Steps *</label>
              <button
                onClick={handleAddStep}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                <Plus className="w-3 h-3" />
                Add Step
              </button>
            </div>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="p-3 bg-muted/30 rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold">Step {i + 1}</span>
                    {steps.length > 1 && (
                      <button
                        onClick={() => handleRemoveStep(i)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Template</label>
                      <select
                        value={step.templateId}
                        onChange={(e) => handleStepChange(i, 'templateId', e.target.value)}
                        className="w-full px-2 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">— Select —</option>
                        {templates.map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.channel})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Delay (minutes after start)</label>
                      <input
                        type="number"
                        value={step.delayMinutes}
                        onChange={(e) => handleStepChange(i, 'delayMinutes', e.target.value)}
                        min={0}
                        className="w-full px-2 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {step.delayMinutes === 0 ? 'Immediate' :
                         step.delayMinutes < 60 ? `${step.delayMinutes}m` :
                         step.delayMinutes < 1440 ? `${Math.round(step.delayMinutes / 60)}h` :
                         `${Math.round(step.delayMinutes / 1440)}d`}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {templates.length === 0 && (
              <p className="text-xs text-amber-600 mt-2">
                No active templates found. Create templates first in Notification Templates page.
              </p>
            )}
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
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Campaign
          </button>
        </div>
      </div>
    </div>
  )
}
