'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Layers, Plus, X, Save, Loader2, Play, Trash2, Clock,
  CheckCircle2, XCircle, AlertCircle, TrendingUp, Calendar, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const STATUS_BADGE: Record<string, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  scheduled: 'warning',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

const ACTION_LABELS: Record<string, string> = {
  change_plan: 'Change Plan',
  message: 'Send Message',
  ban: 'Ban Users',
  delete: 'Delete Users',
  export: 'Export Data',
}

export default function BulkJobsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all')
  const [showEditor, setShowEditor] = useState(false)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-bulk-jobs-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/bulk-jobs?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-bulk-jobs-list', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        status: statusFilter,
      })
      const r = await fetch(`/api/admin/bulk-jobs?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ EXECUTE MUTATION ============
  const executeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/bulk-jobs/execute', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Executed ${data.processedJobs} jobs`,
        { description: `${data.totalProcessed} users processed · ${data.totalSuccess} success · ${data.totalFailed} failed` }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Execution failed', { description: err.message })
    },
  })

  // ============ CANCEL MUTATION ============
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/bulk-jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Job cancelled')
      queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Cancel failed', { description: err.message })
    },
  })

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/bulk-jobs/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Job deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Delete failed', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const jobs = listData?.jobs || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Bulk Operations"
        description="Schedule bulk actions (plan change, message, ban, delete) for future execution"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition disabled:opacity-50"
            >
              {executeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Execute Due Jobs
            </button>
            <button
              onClick={() => setShowEditor(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
            >
              <Plus className="w-4 h-4" />
              New Bulk Job
            </button>
          </div>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Jobs', icon: Layers },
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
                  label="Scheduled"
                  value={formatNumber(ov.scheduledCount || 0)}
                  icon={Clock}
                  iconColor="text-amber-600"
                  sublabel="Waiting to execute"
                />
                <KPICard
                  label="Completed"
                  value={formatNumber(ov.completedCount || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel="Successfully executed"
                />
                <KPICard
                  label="Failed"
                  value={formatNumber(ov.failedCount || 0)}
                  icon={XCircle}
                  iconColor="text-red-600"
                  sublabel="Execution errors"
                />
                <KPICard
                  label="Total Users Processed"
                  value={formatNumber(ov.totalProcessed || 0)}
                  icon={Layers}
                  iconColor="text-violet-600"
                  sublabel="Across all jobs"
                />
              </KPIGrid>

              {/* Upcoming jobs */}
              {overview.upcomingJobs?.length > 0 && (
                <ContentCard title="Upcoming Scheduled Jobs">
                  <div className="p-4 space-y-2">
                    {overview.upcomingJobs.map((j: any) => (
                      <div key={j.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                        <div>
                          <p className="text-sm font-medium">{j.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {ACTION_LABELS[j.action] || j.action} · {j.totalTargets} targets
                          </p>
                        </div>
                        <Badge variant="warning">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {formatRelativeTime(j.scheduledAt)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ContentCard>
              )}

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How bulk operations work (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">5 Action Types:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Change Plan</strong>: bulk upgrade/downgrade user plans</li>
                      <li>• <strong>Send Message</strong>: bulk SMS/email/push notification</li>
                      <li>• <strong>Ban Users</strong>: bulk ban (mark banned=true)</li>
                      <li>• <strong>Delete Users</strong>: bulk soft-delete (mark banned)</li>
                      <li>• <strong>Export Data</strong>: bulk CSV export</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Targeting + Scheduling:</p>
                    <ul className="space-y-0.5">
                      <li>• Target by: specific user IDs, plan tier, or segment</li>
                      <li>• Schedule for future execution (e.g. "Jan 1 9 AM")</li>
                      <li>• Cron job executes due jobs every minute</li>
                      <li>• Max 1000 users per synchronous job (production: background queue)</li>
                      <li>• All actions logged to AdminAction audit trail</li>
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
            {(['all', 'scheduled', 'running', 'completed', 'failed', 'cancelled'] as const).map((s) => (
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

          <ContentCard title={`Bulk Jobs — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : jobs.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="No bulk jobs"
                description={statusFilter !== 'all' ? "Try a different filter" : "Click 'New Bulk Job' to schedule one"}
              />
            ) : (
              <div className="divide-y divide-border">
                {jobs.map((j: any) => (
                  <div key={j.id} className="p-4 hover:bg-muted/30 transition">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-medium">{j.name}</p>
                          <Badge variant={STATUS_BADGE[j.status] || 'neutral'}>{j.status}</Badge>
                          <Badge variant="info">{ACTION_LABELS[j.action] || j.action}</Badge>
                          <Badge variant="neutral">{j.targetType}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span><Calendar className="w-3 h-3 inline mr-1" />Scheduled: {formatRelativeTime(j.scheduledAt)}</span>
                          {j.totalTargets > 0 && (
                            <>
                              <span>·</span>
                              <span>{j.processedCount}/{j.totalTargets} processed</span>
                              <span className="text-emerald-600">✓ {j.successCount}</span>
                              {j.failedCount > 0 && <span className="text-red-600">✗ {j.failedCount}</span>}
                            </>
                          )}
                          {j.completedAt && <span>· Completed {formatRelativeTime(j.completedAt)}</span>}
                        </div>
                        {j.errorMessage && (
                          <p className="text-xs text-red-600 mt-1">⚠ {j.errorMessage}</p>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        {j.status === 'scheduled' && (
                          <button
                            onClick={() => {
                              if (confirm(`Cancel job "${j.name}"?`)) cancelMutation.mutate(j.id)
                            }}
                            className="px-2 py-1 text-xs font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600"
                          >
                            Cancel
                          </button>
                        )}
                        {['scheduled', 'cancelled', 'failed'].includes(j.status) && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete job "${j.name}"?`)) deleteMutation.mutate(j.id)
                            }}
                            className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
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
        <BulkJobEditor
          onClose={() => setShowEditor(false)}
          onCreated={() => {
            setShowEditor(false)
            queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-list'] })
            queryClient.invalidateQueries({ queryKey: ['admin-bulk-jobs-overview'] })
            setTab('list')
          }}
        />
      )}
    </div>
  )
}

// =====================================================================
// BULK JOB EDITOR MODAL
// =====================================================================
function BulkJobEditor({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [action, setAction] = useState('change_plan')
  const [targetType, setTargetType] = useState<'plan' | 'segment' | 'userIds'>('plan')
  const [planTarget, setPlanTarget] = useState('free')
  const [segmentId, setSegmentId] = useState('')
  const [userIdsText, setUserIdsText] = useState('')
  const [newPlan, setNewPlan] = useState('pro')
  const [messageSubject, setMessageSubject] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await fetch('/api/admin/bulk-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Bulk job scheduled')
      onCreated()
    },
    onError: (err: Error) => {
      toast.error('Create failed', { description: err.message })
    },
  })

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!scheduledAt) {
      toast.error('Scheduled time is required')
      return
    }

    // Build target criteria
    let targetCriteria: any = {}
    if (targetType === 'plan') {
      targetCriteria = { plan: planTarget }
    } else if (targetType === 'segment') {
      targetCriteria = { segmentId }
    } else if (targetType === 'userIds') {
      targetCriteria = {
        userIds: userIdsText.split('\n').map(s => s.trim()).filter(Boolean),
      }
    }

    // Build action params
    let actionParams: any = {}
    if (action === 'change_plan') {
      actionParams = { plan: newPlan }
    } else if (action === 'message') {
      actionParams = { subject: messageSubject, message: messageBody, channel: 'email' }
    }

    createMutation.mutate({
      name,
      action,
      targetType: 'user',
      targetCriteria,
      actionParams,
      scheduledAt,
    })
  }

  const now = new Date()
  const minDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

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
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>New Bulk Job</h2>
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
              placeholder="e.g. Upgrade all free users to Pro on New Year"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Action *</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="change_plan">Change Plan</option>
                <option value="message">Send Message</option>
                <option value="ban">Ban Users</option>
                <option value="delete">Delete Users</option>
                <option value="export">Export Data</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Schedule For *</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={minDateTime}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* Target selection */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Target Users</p>
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                {(['plan', 'segment', 'userIds'] as const).map(t => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={targetType === t}
                      onChange={() => setTargetType(t)}
                    />
                    <span className="text-sm capitalize">{t === 'userIds' ? 'Specific Users' : t}</span>
                  </label>
                ))}
              </div>

              {targetType === 'plan' && (
                <select
                  value={planTarget}
                  onChange={(e) => setPlanTarget(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="free">Free users</option>
                  <option value="pro">Pro users</option>
                  <option value="elite">Elite users</option>
                </select>
              )}

              {targetType === 'segment' && (
                <input
                  type="text"
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  placeholder="Segment ID (e.g. power_users, at_risk)"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              )}

              {targetType === 'userIds' && (
                <textarea
                  value={userIdsText}
                  onChange={(e) => setUserIdsText(e.target.value)}
                  rows={4}
                  placeholder="User IDs (one per line)&#10;cmd1abc...&#10;cmd2def..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              )}
            </div>
          </div>

          {/* Action params */}
          {action === 'change_plan' && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">New Plan</p>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="elite">Elite</option>
              </select>
            </div>
          )}

          {action === 'message' && (
            <div className="border-t border-slate-100 pt-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Message Content</p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Subject</label>
                <input
                  type="text"
                  value={messageSubject}
                  onChange={(e) => setMessageSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Body</label>
                <textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  rows={4}
                  placeholder="Message body..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          )}

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-800">
              ⚠️ Bulk jobs are powerful. Max 1000 users per synchronous execution.
              All actions are logged to the audit trail. Test with a small group first.
            </p>
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
            Schedule Job
          </button>
        </div>
      </div>
    </div>
  )
}
