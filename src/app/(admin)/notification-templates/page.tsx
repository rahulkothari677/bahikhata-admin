'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  MessageSquare, Mail, Smartphone, Bell, Plus, Edit3, Trash2,
  Copy, AlertCircle, X, Save, Eye, TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const CHANNEL_CONFIG: Record<string, { icon: any; color: string; badge: 'info' | 'success' | 'warning' }> = {
  sms: { icon: Smartphone, color: 'text-blue-600', badge: 'info' },
  email: { icon: Mail, color: 'text-violet-600', badge: 'info' },
  push: { icon: Bell, color: 'text-amber-600', badge: 'warning' },
}

const STATUS_BADGE: Record<string, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  draft: 'warning',
  archived: 'neutral',
}

const CATEGORY_BADGE: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  payment: 'success',
  onboarding: 'info',
  churn: 'danger',
  promotional: 'warning',
  general: 'neutral',
}

export default function NotificationTemplatesPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<'all' | 'sms' | 'email' | 'push'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'active' | 'archived'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'general' | 'payment' | 'onboarding' | 'churn' | 'promotional'>('all')

  // Editor state
  const [editing, setEditing] = useState<any>(null)
  const [showEditor, setShowEditor] = useState(false)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-templates-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/notification-templates?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-templates-list', page, search, channelFilter, statusFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        channel: channelFilter,
        status: statusFilter,
        category: categoryFilter,
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/notification-templates?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ CREATE/UPDATE MUTATION ============
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const isEdit = !!data.id
      const url = isEdit
        ? `/api/admin/notification-templates/${data.id}`
        : '/api/admin/notification-templates'
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
      toast.success(data.template ? `Template saved (v${data.template.version})` : 'Saved')
      queryClient.invalidateQueries({ queryKey: ['admin-templates-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-templates-overview'] })
      setShowEditor(false)
      setEditing(null)
    },
    onError: (err: Error) => {
      toast.error('Save failed', { description: err.message })
    },
  })

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/notification-templates/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Template deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-templates-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-templates-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Delete failed', { description: err.message })
    },
  })

  const handleDelete = (template: any) => {
    if (confirm(`Delete "${template.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(template.id)
    }
  }

  const handleDuplicate = async (template: any) => {
    // Duplicate by creating a new template with same content + " (Copy)" suffix
    setShowEditor(true)
    setEditing({
      ...template,
      id: null,
      name: `${template.name} (Copy)`,
      status: 'draft',
      version: 1,
    })
    toast.info('Template duplicated — review and save')
  }

  const openEditor = (template?: any) => {
    setEditing(template || {
      id: null,
      name: '',
      category: 'general',
      channel: 'sms',
      subject: '',
      body: '',
      language: 'en',
      status: 'draft',
    })
    setShowEditor(true)
  }

  // ============ DERIVED ============
  const ov = overview?.overview || {}
  const channelDist = overview?.channelDistribution || {}
  const templates = listData?.templates || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Notification Templates"
        description="Reusable SMS, Email, and Push templates with {{variable}} substitution"
        actions={
          <button
            onClick={() => openEditor()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Templates', icon: MessageSquare },
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
              title="Failed to load templates"
              description="Please try refreshing the page"
            />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Total Templates"
                  value={String(ov.totalCount || 0)}
                  icon={MessageSquare}
                  iconColor="text-violet-600"
                  sublabel="Across all channels"
                />
                <KPICard
                  label="Active"
                  value={String(ov.activeCount || 0)}
                  icon={Mail}
                  iconColor="text-emerald-600"
                  sublabel="Ready to send"
                />
                <KPICard
                  label="Drafts"
                  value={String(ov.draftCount || 0)}
                  icon={Edit3}
                  iconColor="text-amber-600"
                  sublabel="Not yet activated"
                />
                <KPICard
                  label="Archived"
                  value={String(ov.archivedCount || 0)}
                  icon={Copy}
                  iconColor="text-slate-600"
                  sublabel="Out of rotation"
                />
              </KPIGrid>

              {/* Channel distribution */}
              <ContentCard title="Active Templates by Channel">
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(['sms', 'email', 'push'] as const).map((ch) => {
                    const cfg = CHANNEL_CONFIG[ch]
                    const Icon = cfg.icon
                    const count = channelDist[ch] || 0
                    const total = (channelDist.sms || 0) + (channelDist.email || 0) + (channelDist.push || 0)
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0
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
                        <p className="text-xs text-muted-foreground">{pct}% of active templates</p>
                      </div>
                    )
                  })}
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How templates work (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Variable Substitution:</p>
                    <ul className="space-y-0.5">
                      <li>• Use <code className="text-[11px] bg-muted px-1 rounded">{`{{variableName}}`}</code> in body</li>
                      <li>• Variables auto-detected on save (no manual entry needed)</li>
                      <li>• Example: <code className="text-[11px] bg-muted px-1 rounded">{`Hi {{userName}}, your bill of ₹{{amount}} is due.`}</code></li>
                      <li>• Supported: userName, amount, plan, dueDate, etc.</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Versioning & Audit:</p>
                    <ul className="space-y-0.5">
                      <li>• Each edit bumps <code className="text-[11px] bg-muted px-1 rounded">version</code> (v1 → v2 → v3…)</li>
                      <li>• All create/update/delete actions logged to AuditLog</li>
                      <li>• Status: draft → active → archived (lifecycle)</li>
                      <li>• Languages: en, hi, bilingual (for Hindi-speaking users)</li>
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
                placeholder="Search by name or body..."
              />
            </div>
            <div className="flex items-center gap-2">
              {(['all', 'sms', 'email', 'push'] as const).map((c) => {
                const Icon = c === 'all' ? MessageSquare : CHANNEL_CONFIG[c].icon
                return (
                  <button
                    key={c}
                    onClick={() => { setChannelFilter(c); setPage(1) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition uppercase ${
                      channelFilter === c
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
              {(['all', 'draft', 'active', 'archived'] as const).map((s) => (
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

          <ContentCard title={`Templates — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : templates.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No templates found"
                description={search || channelFilter !== 'all' || statusFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "Click 'New Template' to create your first one"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Name</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Channel</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Category</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Version</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Updated</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {templates.map((t: any) => {
                    const cfg = CHANNEL_CONFIG[t.channel] || CHANNEL_CONFIG.sms
                    const Icon = cfg.icon
                    return (
                      <tr key={t.id} className="hover:bg-muted/30 transition">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openEditor(t)}
                            className="text-sm font-medium hover:underline text-left"
                          >
                            {t.name}
                          </button>
                          <p className="text-xs text-muted-foreground truncate max-w-xs">{t.body.slice(0, 60)}…</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-sm">
                            <Icon className={`w-4 h-4 ${cfg.color}`} />
                            <span className="uppercase">{t.channel}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={CATEGORY_BADGE[t.category] || 'neutral'}>{t.category}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_BADGE[t.status] || 'neutral'}>{t.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">v{t.version}</td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {formatRelativeTime(t.updatedAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditor(t)}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                              title="Edit"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDuplicate(t)}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                              title="Duplicate"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(t)}
                              disabled={deleteMutation.isPending}
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600 transition"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
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
        <TemplateEditor
          template={editing}
          onClose={() => { setShowEditor(false); setEditing(null) }}
          onSave={(data) => saveMutation.mutate(data)}
          saving={saveMutation.isPending}
        />
      )}
    </div>
  )
}

// =====================================================================
// TEMPLATE EDITOR MODAL
// =====================================================================
function TemplateEditor({
  template,
  onClose,
  onSave,
  saving,
}: {
  template: any
  onClose: () => void
  onSave: (data: any) => void
  saving: boolean
}) {
  const [name, setName] = useState(template?.name || '')
  const [category, setCategory] = useState(template?.category || 'general')
  const [channel, setChannel] = useState(template?.channel || 'sms')
  const [subject, setSubject] = useState(template?.subject || '')
  const [body, setBody] = useState(template?.body || '')
  const [language, setLanguage] = useState(template?.language || 'en')
  const [status, setStatus] = useState(template?.status || 'draft')
  const [showPreview, setShowPreview] = useState(false)

  // Auto-detect variables from body
  const detectedVars = Array.from(new Set(
    Array.from(body.matchAll(/\{\{(\w+)\}\}/g) as IterableIterator<RegExpMatchArray>).map(m => m[1])
  ))

  // Sample values for preview
  const sampleValues: Record<string, string> = {
    userName: 'Rahul',
    amount: '1,500',
    plan: 'Pro',
    dueDate: '15 Jul 2026',
    shopName: 'Sharma Kirana',
    invoiceNumber: 'INV-001',
  }

  const previewBody = body.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => sampleValues[key] || `{{${key}}}`)

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!body.trim()) {
      toast.error('Body is required')
      return
    }
    if (channel === 'email' && !subject.trim()) {
      toast.error('Subject is required for email templates')
      return
    }
    onSave({
      id: template?.id,
      name,
      category,
      channel,
      subject: channel === 'email' ? subject : null,
      body,
      variables: detectedVars,
      language,
      status,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto z-[101]"
        style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>
            {template?.id ? `Edit Template (v${template.version})` : 'New Template'}
          </h2>
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
              placeholder="e.g. Payment Reminder SMS"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Channel + Category + Language + Status (2x2 grid) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Channel *</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="push">Push</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="general">General</option>
                <option value="payment">Payment</option>
                <option value="onboarding">Onboarding</option>
                <option value="churn">Churn Win-back</option>
                <option value="promotional">Promotional</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="bilingual">Bilingual</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/* Subject (email only) */}
          {channel === 'email' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Subject *</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Your BahiKhata Pro subscription is active"
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
              rows={6}
              placeholder={
                channel === 'sms'
                  ? 'Hi {{userName}}, your payment of ₹{{amount}} is due on {{dueDate}}. Pay now to avoid service interruption. - BahiKhata Pro'
                  : channel === 'email'
                  ? 'Dear {{userName}},\n\nThank you for subscribing to BahiKhata Pro ({{plan}} plan). Your subscription is active until {{dueDate}}.\n\nBest regards,\nBahiKhata Pro Team'
                  : 'New invoice {{invoiceNumber}} created for {{shopName}}. Tap to view.'
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {detectedVars.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Detected variables: {detectedVars.map(v => (
                  <code key={v} className="mx-0.5 px-1 bg-muted rounded">{`{{${v}}}`}</code>
                ))}
              </p>
            )}
          </div>

          {/* Preview */}
          {showPreview && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Preview (with sample values)</label>
              <div className="p-3 bg-muted/30 rounded-lg border border-border">
                {channel === 'email' && subject && (
                  <p className="text-sm font-semibold mb-2">{subject.replace(/\{\{(\w+)\}\}/g, (_match: string, k: string) => sampleValues[k] || `{{${k}}}`)}</p>
                )}
                <p className="text-sm whitespace-pre-wrap">{previewBody}</p>
              </div>
            </div>
          )}
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
            {saving ? <Save className="w-4 h-4 animate-pulse" /> : <Save className="w-4 h-4" />}
            {template?.id ? 'Update Template' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  )
}
