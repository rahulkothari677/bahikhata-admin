'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Bell, Send, History, TrendingUp, CheckCircle2, XCircle,
  AlertCircle, Mail, Smartphone, Loader2, Eye, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'compose' | 'history'

const PAGE_SIZE = 20

const CHANNEL_CONFIG: Record<string, { icon: any; color: string; badge: 'info' | 'warning' }> = {
  sms: { icon: Smartphone, color: 'text-blue-600', badge: 'info' },
  email: { icon: Mail, color: 'text-violet-600', badge: 'info' },
  push: { icon: Bell, color: 'text-amber-600', badge: 'warning' },
}

const STATUS_BADGE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  sent: 'success',
  failed: 'danger',
  skipped: 'warning',
  pending: 'neutral',
}

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [historyPage, setHistoryPage] = useState(1)
  const [historySearch, setHistorySearch] = useState('')
  const [historyChannel, setHistoryChannel] = useState<'all' | 'sms' | 'email' | 'push'>('all')
  const [historyStatus, setHistoryStatus] = useState<'all' | 'sent' | 'failed' | 'skipped'>('all')

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-notifications-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/notifications/log?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ PROVIDER STATUS ============
  const { data: providerStatus } = useQuery({
    queryKey: ['admin-notifications-status'],
    queryFn: async () => {
      const r = await fetch('/api/admin/notifications/status')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  // ============ HISTORY DATA ============
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['admin-notifications-history', historyPage, historySearch, historyChannel, historyStatus],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(historyPage),
        channel: historyChannel,
        status: historyStatus,
      })
      if (historySearch) params.set('search', historySearch)
      const r = await fetch(`/api/admin/notifications/log?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'history',
    staleTime: 30 * 1000,
  })

  const ov = overview?.overview || {}
  const channelDist = overview?.channelDistribution || {}
  const logs = historyData?.logs || []
  const total = historyData?.total || 0
  const totalPages = historyData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Send Notifications"
        description="Send SMS, Email, and Push notifications using templates · provider-agnostic with dry-run fallback"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'compose' as const, label: 'Compose & Send', icon: Send },
          { id: 'history' as const, label: 'Send History', icon: History },
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
              title="Failed to load overview"
              description="Please try refreshing"
            />
          ) : (
            <>
              {/* Provider status banner */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Provider Configuration
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(['sms', 'email', 'push'] as const).map((ch) => {
                    const cfg = CHANNEL_CONFIG[ch]
                    const Icon = cfg.icon
                    const status = providerStatus?.providers?.[ch]
                    const configured = status?.configured
                    const providerName = status?.provider
                    return (
                      <div
                        key={ch}
                        className={`rounded-lg border p-3 ${configured ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50 dark:bg-amber-950/20'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Icon className={`w-5 h-5 ${cfg.color}`} />
                            <span className="text-sm font-medium uppercase">{ch}</span>
                          </div>
                          {configured ? (
                            <Badge variant="success">✓ {providerName}</Badge>
                          ) : (
                            <Badge variant="warning">Dry-run</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {configured
                            ? `Ready to send via ${providerName}`
                            : `Not configured — sends will be logged but not delivered`}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 4 KPI cards */}
              <KPIGrid>
                <KPICard
                  label="Total Sent (all time)"
                  value={formatNumber(ov.totalCount || 0)}
                  icon={Bell}
                  iconColor="text-violet-600"
                  sublabel={`${ov.recent7d || 0} in last 7 days`}
                />
                <KPICard
                  label="Successfully Delivered"
                  value={formatNumber(ov.sentCount || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.successRate || 0}% success rate`}
                />
                <KPICard
                  label="Failed"
                  value={formatNumber(ov.failedCount || 0)}
                  icon={XCircle}
                  iconColor="text-red-600"
                  sublabel="Provider errors, invalid numbers"
                />
                <KPICard
                  label="Skipped (Dry-run)"
                  value={formatNumber(ov.skippedCount || 0)}
                  icon={AlertCircle}
                  iconColor="text-amber-600"
                  sublabel="Logged but not delivered (no provider)"
                />
              </KPIGrid>

              {/* Channel distribution */}
              <ContentCard title="Notifications by Channel (All Time)">
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(['sms', 'email', 'push'] as const).map((ch) => {
                    const cfg = CHANNEL_CONFIG[ch]
                    const Icon = cfg.icon
                    const count = channelDist[ch] || 0
                    const totalAll = (channelDist.sms || 0) + (channelDist.email || 0) + (channelDist.push || 0)
                    const pct = totalAll > 0 ? Math.round((count / totalAll) * 100) : 0
                    return (
                      <div key={ch} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Icon className={`w-5 h-5 ${cfg.color}`} />
                            <span className="text-sm font-medium uppercase">{ch}</span>
                          </div>
                          <span className="text-2xl font-bold">{count}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${ch === 'sms' ? 'bg-blue-500' : ch === 'email' ? 'bg-violet-500' : 'bg-amber-500'} transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{pct}% of all sends</p>
                      </div>
                    )
                  })}
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How sending works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Provider-Agnostic Architecture:</p>
                    <ul className="space-y-0.5">
                      <li>• SMS: MSG91 (₹0.20-0.30/SMS) — set <code className="text-[11px] bg-muted px-1 rounded">MSG91_AUTH_KEY</code></li>
                      <li>• Email: Resend (3K/month free) — set <code className="text-[11px] bg-muted px-1 rounded">RESEND_API_KEY</code></li>
                      <li>• Push: Firebase Cloud Messaging (free) — set <code className="text-[11px] bg-muted px-1 rounded">FCM_SERVER_KEY</code></li>
                      <li>• Dry-run mode: if no env var set, send is logged with status=skipped</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Safety & Audit:</p>
                    <ul className="space-y-0.5">
                      <li>• Max 1000 recipients per send (prevents accidental mass send)</li>
                      <li>• Every send (success or failure) logged to NotificationLog</li>
                      <li>• All send actions logged to AdminAction audit trail</li>
                      <li>• Sequential sending (avoids provider rate-limit bans)</li>
                      <li>• Variable substitution: <code className="text-[11px] bg-muted px-1 rounded">{`{{userName}}`}</code> → actual user data</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ COMPOSE TAB ============ */}
      {tab === 'compose' && (
        <ComposeTab onSent={() => {
          queryClient.invalidateQueries({ queryKey: ['admin-notifications-overview'] })
          queryClient.invalidateQueries({ queryKey: ['admin-notifications-history'] })
          setTab('history')
        }} />
      )}

      {/* ============ HISTORY TAB ============ */}
      {tab === 'history' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <SearchBar
                value={historySearch}
                onChange={(v) => { setHistorySearch(v); setHistoryPage(1) }}
                placeholder="Search by recipient or template name..."
              />
            </div>
            <div className="flex items-center gap-2">
              {(['all', 'sms', 'email', 'push'] as const).map((c) => {
                const Icon = c === 'all' ? History : CHANNEL_CONFIG[c].icon
                return (
                  <button
                    key={c}
                    onClick={() => { setHistoryChannel(c); setHistoryPage(1) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition uppercase ${
                      historyChannel === c
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {c}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              {(['all', 'sent', 'failed', 'skipped'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setHistoryStatus(s); setHistoryPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                    historyStatus === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <ContentCard title={`Send History — ${total} total`}>
            {historyLoading ? (
              <LoadingSkeleton rows={10} />
            ) : logs.length === 0 ? (
              <EmptyState
                icon={History}
                title="No notifications sent yet"
                description={historySearch || historyChannel !== 'all' || historyStatus !== 'all'
                  ? "Try adjusting your filters"
                  : "Go to 'Compose & Send' tab to send your first notification"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Recipient</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Channel</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Template</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Provider</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Sent At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((log: any) => {
                    const cfg = CHANNEL_CONFIG[log.channel] || CHANNEL_CONFIG.sms
                    const Icon = cfg.icon
                    return (
                      <tr key={log.id} className="hover:bg-muted/30 transition">
                        <td className="px-4 py-3">
                          <p className="text-sm font-mono">{log.recipient}</p>
                          {log.errorMessage && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{log.errorMessage}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-sm">
                            <Icon className={`w-4 h-4 ${cfg.color}`} />
                            <span className="uppercase">{log.channel}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {log.templateName || <span className="text-muted-foreground italic">Direct send</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_BADGE[log.status] || 'neutral'}>{log.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {log.provider || '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {formatRelativeTime(log.sentAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </ContentCard>

          {total > 0 && (
            <Pagination
              page={historyPage}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setHistoryPage}
            />
          )}
        </>
      )}
    </div>
  )
}

// =====================================================================
// COMPOSE TAB COMPONENT
// =====================================================================
function ComposeTab({ onSent }: { onSent: () => void }) {
  const [mode, setMode] = useState<'template' | 'direct'>('template')
  const [templateId, setTemplateId] = useState('')
  const [channel, setChannel] = useState<'sms' | 'email' | 'push'>('sms')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipientsInput, setRecipientsInput] = useState('') // textarea: one per line
  const [userIdsInput, setUserIdsInput] = useState('') // textarea: one per line
  const [showPreview, setShowPreview] = useState(false)

  // Fetch active templates
  const { data: templatesData } = useQuery({
    queryKey: ['admin-active-templates'],
    queryFn: async () => {
      const r = await fetch('/api/admin/notifications/templates')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const templates = templatesData?.templates || []
  const selectedTemplate = templates.find((t: any) => t.id === templateId)

  const sendMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await fetch('/api/admin/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      const msg = `Sent: ${data.totalSent} · Failed: ${data.totalFailed} · Skipped: ${data.totalSkipped}`
      toast.success('Notifications processed', { description: msg })
      // Reset form
      setTemplateId('')
      setSubject('')
      setBody('')
      setRecipientsInput('')
      setUserIdsInput('')
      onSent()
    },
    onError: (err: Error) => {
      toast.error('Send failed', { description: err.message })
    },
  })

  const handleSend = () => {
    if (mode === 'template') {
      if (!templateId) {
        toast.error('Please select a template')
        return
      }
      const userIds = userIdsInput
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
      if (userIds.length === 0) {
        toast.error('Please enter at least one user ID')
        return
      }
      sendMutation.mutate({ mode: 'template', templateId, userIds })
    } else {
      if (!body.trim()) {
        toast.error('Body is required')
        return
      }
      if (channel === 'email' && !subject.trim()) {
        toast.error('Subject is required for email')
        return
      }
      const recipients = recipientsInput
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
      if (recipients.length === 0) {
        toast.error('Please enter at least one recipient')
        return
      }
      sendMutation.mutate({ mode: 'direct', channel, subject, body, recipients })
    }
  }

  // Preview body with sample variables
  const previewBody = body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const samples: Record<string, string> = {
      userName: 'Rahul',
      amount: '1,500',
      plan: 'Pro',
      dueDate: '15 Jul 2026',
      shopName: 'Sharma Kirana',
    }
    return samples[key] || `{{${key}}}`
  })

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Mode:</span>
        {(['template', 'direct'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              mode === m
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {m === 'template' ? 'Use Template' : 'Direct Compose'}
          </button>
        ))}
      </div>

      <ContentCard title={mode === 'template' ? 'Send via Template' : 'Direct Compose'}>
        <div className="p-4 space-y-4">
          {mode === 'template' ? (
            <>
              {/* Template selector */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Select Active Template *
                </label>
                {templates.length === 0 ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      No active templates found. Go to <strong>Notification Templates</strong> page to create one and set its status to "active".
                    </p>
                  </div>
                ) : (
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— Select a template —</option>
                    {templates.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.channel}, {t.category})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Template preview */}
              {selectedTemplate && (
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Template Preview:</p>
                  {selectedTemplate.channel === 'email' && selectedTemplate.subject && (
                    <p className="text-sm font-semibold mb-1">Subject: {selectedTemplate.subject}</p>
                  )}
                  <p className="text-sm whitespace-pre-wrap">{selectedTemplate.body}</p>
                  {selectedTemplate.variables.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Variables: {selectedTemplate.variables.map((v: string) => (
                        <code key={v} className="mx-0.5 px-1 bg-muted rounded">{`{{${v}}}`}</code>
                      ))}
                    </p>
                  )}
                </div>
              )}

              {/* User IDs input */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  User IDs (one per line) *
                </label>
                <textarea
                  value={userIdsInput}
                  onChange={(e) => setUserIdsInput(e.target.value)}
                  rows={5}
                  placeholder={'cmd1abc2def3ghi4\n\ncmd2jkl3mno4pqr5\n\n...'}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Variables (userName, userEmail, plan) will be auto-substituted from each user's data.
                  {templateId && selectedTemplate && (
                    <> Channel: <strong>{selectedTemplate.channel}</strong> — recipients need {selectedTemplate.channel === 'sms' ? 'phone number' : selectedTemplate.channel === 'email' ? 'email' : 'device token'} in their profile.</>
                  )}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Channel selector */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Channel *</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as any)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="push">Push</option>
                </select>
              </div>

              {/* Subject (email only) */}
              {channel === 'email' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Subject *</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Email subject..."
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">Body *</label>
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Eye className="w-3 h-3" />
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                  </button>
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  placeholder={
                    channel === 'sms'
                      ? 'Hi Rahul, your bill of ₹1,500 is due on 15 Jul.'
                      : channel === 'email'
                      ? 'Dear Rahul,\n\nThank you for your subscription...'
                      : 'New invoice created for Sharma Kirana.'
                  }
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {showPreview && (
                  <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Preview:</p>
                    <p className="text-sm whitespace-pre-wrap">{previewBody}</p>
                  </div>
                )}
              </div>

              {/* Recipients input */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Recipients (one per line) *
                </label>
                <textarea
                  value={recipientsInput}
                  onChange={(e) => setRecipientsInput(e.target.value)}
                  rows={5}
                  placeholder={
                    channel === 'sms'
                      ? '9876543210\n\n9123456780\n\n...'
                      : channel === 'email'
                      ? 'rahul@example.com\n\npriya@example.com\n\n...'
                      : 'deviceToken1\n\ndeviceToken2\n\n...'
                  }
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Max 1000 recipients per send. For direct mode, variables are NOT auto-substituted (use template mode for that).
                </p>
              </div>
            </>
          )}

          {/* Send button */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              onClick={handleSend}
              disabled={sendMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Notification
                </>
              )}
            </button>
          </div>
        </div>
      </ContentCard>
    </div>
  )
}
