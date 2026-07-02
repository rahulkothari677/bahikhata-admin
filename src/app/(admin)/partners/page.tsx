'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Building2, Plus, Edit3, Trash2, X, Save, Loader2,
  TrendingUp, Globe, Mail, Phone, AlertCircle, Handshake,
  Banknote, Package, CreditCard,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber, formatINR } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const TYPE_CONFIG: Record<string, { icon: any; color: string; badge: 'info' | 'success' | 'warning' | 'neutral'; label: string }> = {
  nbfc: { icon: Banknote, color: 'text-emerald-600', badge: 'success', label: 'NBFC (Lending)' },
  fmcg: { icon: Package, color: 'text-blue-600', badge: 'info', label: 'FMCG (Supplier Intel)' },
  fintech: { icon: CreditCard, color: 'text-violet-600', badge: 'warning', label: 'Fintech' },
  other: { icon: Building2, color: 'text-slate-600', badge: 'neutral', label: 'Other' },
}

const STATUS_BADGE: Record<string, 'info' | 'success' | 'neutral' | 'danger'> = {
  onboarding: 'info',
  active: 'success',
  inactive: 'neutral',
  terminated: 'danger',
}

export default function PartnersPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'nbfc' | 'fmcg' | 'fintech' | 'other'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'onboarding' | 'active' | 'inactive' | 'terminated'>('all')
  const [showEditor, setShowEditor] = useState(false)
  const [editingPartner, setEditingPartner] = useState<any>(null)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-partners-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/partners?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-partners-list', page, search, typeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        type: typeFilter,
        status: statusFilter,
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/partners?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ SAVE MUTATION ============
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const isEdit = !!data.id
      const url = isEdit ? `/api/admin/partners/${data.id}` : '/api/admin/partners'
      const r = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || result.detail || `HTTP ${r.status}`)
      return result
    },
    onSuccess: () => {
      toast.success('Partner saved')
      queryClient.invalidateQueries({ queryKey: ['admin-partners-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-partners-overview'] })
      setShowEditor(false)
      setEditingPartner(null)
    },
    onError: (err: Error) => {
      toast.error('Save failed', { description: err.message })
    },
  })

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/partners/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Partner deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-partners-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-partners-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Delete failed', { description: err.message })
    },
  })

  const handleDelete = (partner: any) => {
    if (confirm(`Delete "${partner.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(partner.id)
    }
  }

  const openEditor = (partner?: any) => {
    setEditingPartner(partner || null)
    setShowEditor(true)
  }

  // ============ DERIVED ============
  const ov = overview?.overview || {}
  const typeDist = overview?.typeDistribution || {}
  const partners = listData?.partners || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Partner Management"
        description="NBFC, FMCG, and fintech partners for lending + data monetization pipeline"
        actions={
          <button
            onClick={() => openEditor()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Partner
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Partners', icon: Handshake },
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
              title="Failed to load partners"
              description="Please try refreshing"
            />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Active Partners"
                  value={formatNumber(ov.activeCount || 0)}
                  icon={Handshake}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.onboardingCount || 0} onboarding · ${ov.inactiveCount || 0} inactive`}
                />
                <KPICard
                  label="Total Leads Sent"
                  value={formatNumber(ov.totalLeadsSent || 0)}
                  icon={TrendingUp}
                  iconColor="text-blue-600"
                  sublabel="Across all partners"
                />
                <KPICard
                  label="Revenue Shared"
                  value={formatINR(ov.totalRevenueShared || 0)}
                  icon={Banknote}
                  iconColor="text-violet-600"
                  sublabel="Total monetization revenue"
                />
                <KPICard
                  label="Terminated"
                  value={formatNumber(ov.terminatedCount || 0)}
                  icon={AlertCircle}
                  iconColor="text-red-600"
                  sublabel="Contracts ended"
                />
              </KPIGrid>

              {/* Partner types breakdown */}
              <ContentCard title="Active Partners by Type">
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {(['nbfc', 'fmcg', 'fintech', 'other'] as const).map((t) => {
                    const cfg = TYPE_CONFIG[t]
                    const Icon = cfg.icon
                    const data = typeDist[t] || { count: 0, leads: 0, revenue: 0 }
                    return (
                      <div key={t} className="p-3 bg-muted/30 rounded-lg border border-border">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Icon className={`w-5 h-5 ${cfg.color}`} />
                            <span className="text-sm font-medium">{cfg.label}</span>
                          </div>
                          <span className="text-2xl font-bold">{data.count}</span>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Leads sent:</span>
                            <span className="font-medium text-foreground">{formatNumber(data.leads)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Revenue:</span>
                            <span className="font-medium text-foreground">{formatINR(data.revenue)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How partner management works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Partner Types:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>NBFC</strong>: Lending partners — receive credit-scored leads (₹200/₹150/₹100 per lead)</li>
                      <li>• <strong>FMCG</strong>: Supplier intelligence — receive anonymized market data (₹50K-₹5L/report)</li>
                      <li>• <strong>Fintech</strong>: Other integrations (payments, accounting) — revenue share %</li>
                      <li>• <strong>Other</strong>: Custom partnerships</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Lifecycle & Compliance:</p>
                    <ul className="space-y-0.5">
                      <li>• Status: onboarding → active → inactive → terminated</li>
                      <li>• Contract dates tracked (start + end)</li>
                      <li>• Revenue share % configurable per partner</li>
                      <li>• DPDP compliance: get user consent before sharing data</li>
                      <li>• All partner actions logged to AdminAction audit trail</li>
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
                placeholder="Search by name, contact name, or email..."
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'nbfc', 'fmcg', 'fintech', 'other'] as const).map((t) => {
                const Icon = t === 'all' ? Handshake : TYPE_CONFIG[t].icon
                return (
                  <button
                    key={t}
                    onClick={() => { setTypeFilter(t); setPage(1) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition uppercase ${
                      typeFilter === t
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {t}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'onboarding', 'active', 'inactive', 'terminated'] as const).map((s) => (
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

          <ContentCard title={`Partners — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : partners.length === 0 ? (
              <EmptyState
                icon={Handshake}
                title="No partners found"
                description={search || typeFilter !== 'all' || statusFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "Click 'New Partner' to add your first partner"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Name</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Type</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Contact</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Leads</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Revenue</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {partners.map((p: any) => {
                    const cfg = TYPE_CONFIG[p.type] || TYPE_CONFIG.other
                    const Icon = cfg.icon
                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openEditor(p)}
                            className="text-sm font-medium hover:underline text-left"
                          >
                            {p.name}
                          </button>
                          {p.website && (
                            <a
                              href={p.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs text-blue-600 hover:underline"
                            >
                              {p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-sm">
                            <Icon className={`w-4 h-4 ${cfg.color}`} />
                            <span className="uppercase">{p.type}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_BADGE[p.status] || 'neutral'}>{p.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {p.contactName || p.contactEmail ? (
                            <div>
                              {p.contactName && <p className="text-sm">{p.contactName}</p>}
                              {p.contactEmail && <p className="text-xs text-muted-foreground">{p.contactEmail}</p>}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums">
                          {formatNumber(p.totalLeadsSent)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium">
                          {formatINR(p.totalRevenueShared)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditor(p)}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                              title="Edit"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
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
        <PartnerEditor
          partner={editingPartner}
          onClose={() => { setShowEditor(false); setEditingPartner(null) }}
          onSave={(data) => saveMutation.mutate(data)}
          saving={saveMutation.isPending}
        />
      )}
    </div>
  )
}

// =====================================================================
// PARTNER EDITOR MODAL
// =====================================================================
function PartnerEditor({
  partner,
  onClose,
  onSave,
  saving,
}: {
  partner: any
  onClose: () => void
  onSave: (data: any) => void
  saving: boolean
}) {
  const [name, setName] = useState(partner?.name || '')
  const [type, setType] = useState(partner?.type || 'nbfc')
  const [status, setStatus] = useState(partner?.status || 'onboarding')
  const [contactName, setContactName] = useState(partner?.contactName || '')
  const [contactEmail, setContactEmail] = useState(partner?.contactEmail || '')
  const [contactPhone, setContactPhone] = useState(partner?.contactPhone || '')
  const [website, setWebsite] = useState(partner?.website || '')
  const [apiBaseUrl, setApiBaseUrl] = useState(partner?.apiBaseUrl || '')
  const [webhookUrl, setWebhookUrl] = useState(partner?.webhookUrl || '')
  const [revenueSharePct, setRevenueSharePct] = useState(partner?.revenueSharePct?.toString() || '0')
  const [contractStartAt, setContractStartAt] = useState(
    partner?.contractStartAt ? new Date(partner.contractStartAt).toISOString().slice(0, 10) : ''
  )
  const [contractEndAt, setContractEndAt] = useState(
    partner?.contractEndAt ? new Date(partner.contractEndAt).toISOString().slice(0, 10) : ''
  )
  const [notes, setNotes] = useState(partner?.notes || '')

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    onSave({
      id: partner?.id,
      name,
      type,
      status,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      website: website || null,
      apiBaseUrl: apiBaseUrl || null,
      webhookUrl: webhookUrl || null,
      revenueSharePct,
      contractStartAt: contractStartAt || null,
      contractEndAt: contractEndAt || null,
      notes: notes || null,
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
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>
            {partner ? 'Edit Partner' : 'New Partner'}
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
          {/* Name + Type + Status */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bajaj Finance Ltd"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="nbfc">NBFC (Lending)</option>
                <option value="fmcg">FMCG (Supplier Intel)</option>
                <option value="fintech">Fintech</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
          </div>

          {/* Contact info */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contact Info</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Contact Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="e.g. Rajesh Kumar"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Contact Email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="rajesh@bajajfinserv.in"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Website</label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://www.bajajfinserv.in"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Integration */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Integration</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">API Base URL</label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.partner.com/v1"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Webhook URL (where we send leads)</label>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://api.partner.com/webhooks/leads"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Revenue Share % (for fintech partners)</label>
                <input
                  type="number"
                  value={revenueSharePct}
                  onChange={(e) => setRevenueSharePct(e.target.value)}
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Contract */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contract</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Contract Start</label>
                <input
                  type="date"
                  value={contractStartAt}
                  onChange={(e) => setContractStartAt(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Contract End</label>
                <input
                  type="date"
                  value={contractEndAt}
                  onChange={(e) => setContractEndAt(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Contract terms, special agreements, etc."
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
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
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {partner ? 'Update Partner' : 'Create Partner'}
          </button>
        </div>
      </div>
    </div>
  )
}
