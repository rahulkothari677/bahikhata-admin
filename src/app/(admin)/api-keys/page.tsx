'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Key, Plus, Edit3, Trash2, X, Save, Loader2, Copy, CheckCircle2,
  AlertTriangle, ShieldCheck, ShieldAlert, Eye, EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const STATUS_BADGE: Record<string, 'success' | 'danger' | 'neutral'> = {
  active: 'success',
  revoked: 'danger',
  expired: 'neutral',
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked' | 'expired'>('all')
  const [showEditor, setShowEditor] = useState(false)
  const [editingKey, setEditingKey] = useState<any>(null)
  const [showRawKeyModal, setShowRawKeyModal] = useState<{ rawKey: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-api-keys-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/api-keys?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-api-keys-list', page, search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        status: statusFilter,
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/api-keys?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ CREATE MUTATION ============
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || result.detail || `HTTP ${r.status}`)
      return result
    },
    onSuccess: (data) => {
      toast.success('API key created')
      queryClient.invalidateQueries({ queryKey: ['admin-api-keys-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-api-keys-overview'] })
      setShowEditor(false)
      // Show the raw key ONCE
      setShowRawKeyModal({ rawKey: data.rawKey, name: data.apiKey.name })
    },
    onError: (err: Error) => {
      toast.error('Create failed', { description: err.message })
    },
  })

  // ============ UPDATE MUTATION ============
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const r = await fetch(`/api/admin/api-keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`)
      return result
    },
    onSuccess: () => {
      toast.success('API key updated')
      queryClient.invalidateQueries({ queryKey: ['admin-api-keys-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-api-keys-overview'] })
      setShowEditor(false)
      setEditingKey(null)
    },
    onError: (err: Error) => {
      toast.error('Update failed', { description: err.message })
    },
  })

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('API key deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-api-keys-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-api-keys-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Delete failed', { description: err.message })
    },
  })

  const handleDelete = (apiKey: any) => {
    if (confirm(`Delete API key "${apiKey.name}"? This cannot be undone. The key will immediately stop working.`)) {
      deleteMutation.mutate(apiKey.id)
    }
  }

  const handleRevoke = (apiKey: any) => {
    if (confirm(`Revoke API key "${apiKey.name}"? The key will immediately stop working but remain in the list for audit.`)) {
      updateMutation.mutate({ id: apiKey.id, status: 'revoked' })
    }
  }

  const handleCopyKey = async (rawKey: string) => {
    try {
      await navigator.clipboard.writeText(rawKey)
      setCopied(true)
      toast.success('Key copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy — please copy manually')
    }
  }

  const openEditor = (apiKey?: any) => {
    setEditingKey(apiKey || null)
    setShowEditor(true)
  }

  // ============ DERIVED ============
  const ov = overview?.overview || {}
  const scopeConfigs = overview?.scopeConfigs || []
  const apiKeys = listData?.apiKeys || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="API Keys"
        description="Partner API keys with scoped permissions · SHA-256 hashed (never stored raw)"
        actions={
          <button
            onClick={() => openEditor()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New API Key
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: ShieldCheck },
          { id: 'list' as const, label: 'All Keys', icon: Key },
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
                  label="Active Keys"
                  value={formatNumber(ov.activeCount || 0)}
                  icon={Key}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.partnerKeysCount || 0} partner · ${ov.internalKeysCount || 0} internal`}
                />
                <KPICard
                  label="Total API Calls"
                  value={formatNumber(ov.totalUsage || 0)}
                  icon={Eye}
                  iconColor="text-blue-600"
                  sublabel="Across all keys (all time)"
                />
                <KPICard
                  label="Revoked"
                  value={formatNumber(ov.revokedCount || 0)}
                  icon={ShieldAlert}
                  iconColor="text-red-600"
                  sublabel="Permanently disabled"
                />
                <KPICard
                  label="Expired"
                  value={formatNumber(ov.expiredCount || 0)}
                  icon={AlertTriangle}
                  iconColor="text-amber-600"
                  sublabel="Past expiration date"
                />
              </KPIGrid>

              {/* Available scopes */}
              <ContentCard title="Available Scopes (6 permissions)">
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {scopeConfigs.map((s: any) => (
                    <div key={s.key} className="p-3 bg-muted/30 rounded-lg border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{s.key}</code>
                        {s.key === 'admin' && <Badge variant="danger">DANGEROUS</Badge>}
                      </div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                    </div>
                  ))}
                </div>
              </ContentCard>

              {/* Security warning */}
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Security Best Practices
                    </p>
                    <ul className="text-xs text-amber-700 dark:text-amber-300 mt-1 space-y-0.5">
                      <li>• API keys are shown <strong>ONCE</strong> on creation — save them immediately</li>
                      <li>• Keys are stored as <strong>SHA-256 hashes</strong> — even we can't see them</li>
                      <li>• Use <strong>scoped keys</strong> (read_leads only) instead of admin keys wherever possible</li>
                      <li>• <strong>Revoke</strong> keys immediately if compromised (don't delete — keep for audit)</li>
                      <li>• Set <strong>expiration dates</strong> on partner keys (renew contractually)</li>
                      <li>• <strong>Rotate</strong> keys annually (revoke old, create new)</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How API key security works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Key Generation:</p>
                    <ul className="space-y-0.5">
                      <li>• 32 random bytes → base64url → prefix with <code className="text-[11px] bg-muted px-1 rounded">bkh_live_</code></li>
                      <li>• Format: <code className="text-[11px] bg-muted px-1 rounded">bkh_live_AbCdEf123...</code> (~52 chars)</li>
                      <li>• Uses <code className="text-[11px] bg-muted px-1 rounded">crypto.randomBytes</code> (cryptographically secure)</li>
                      <li>• Entropy: 256 bits (infeasible to brute-force)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Storage & Verification:</p>
                    <ul className="space-y-0.5">
                      <li>• Stored: SHA-256 hash (64 hex chars) — even DB breach can't reveal keys</li>
                      <li>• Stored: first 12 chars as <code className="text-[11px] bg-muted px-1 rounded">keyPrefix</code> (for display)</li>
                      <li>• Verification: hash provided key, compare with <code className="text-[11px] bg-muted px-1 rounded">timingSafeEqual</code></li>
                      <li>• Timing-safe comparison prevents timing attacks</li>
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
                placeholder="Search by name or key prefix..."
              />
            </div>
            <div className="flex items-center gap-2">
              {(['all', 'active', 'revoked', 'expired'] as const).map((s) => (
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

          <ContentCard title={`API Keys — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : apiKeys.length === 0 ? (
              <EmptyState
                icon={Key}
                title="No API keys found"
                description={search || statusFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "Click 'New API Key' to create your first key"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Name</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Key Prefix</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Partner</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Scopes</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Usage</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Last Used</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {apiKeys.map((k: any) => (
                    <tr key={k.id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openEditor(k)}
                          className="text-sm font-medium hover:underline text-left"
                        >
                          {k.name}
                        </button>
                        {k.expiresAt && (
                          <p className="text-[10px] text-muted-foreground">
                            Expires: {new Date(k.expiresAt).toLocaleDateString()}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{k.keyPrefix}…</code>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {k.partnerName || <span className="text-muted-foreground italic">Internal</span>}
                        {k.partnerType && (
                          <span className="block text-[10px] text-muted-foreground uppercase">{k.partnerType}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s: string) => (
                            <Badge key={s} variant={s === 'admin' ? 'danger' : 'neutral'}>
                              {s === 'admin' ? '⚠ admin' : s.replace('_', ' ')}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_BADGE[k.status] || 'neutral'}>{k.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">
                        {formatNumber(k.usageCount)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {k.status === 'active' && (
                            <button
                              onClick={() => handleRevoke(k)}
                              disabled={updateMutation.isPending}
                              className="p-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-950/20 text-muted-foreground hover:text-amber-600 transition"
                              title="Revoke (disable but keep for audit)"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => openEditor(k)}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(k)}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600 transition"
                            title="Delete (permanent)"
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
        <ApiKeyEditor
          apiKey={editingKey}
          scopeConfigs={scopeConfigs}
          onClose={() => { setShowEditor(false); setEditingKey(null) }}
          onSave={(data) => {
            if (editingKey) {
              updateMutation.mutate({ id: editingKey.id, ...data })
            } else {
              createMutation.mutate(data)
            }
          }}
          saving={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* ============ RAW KEY MODAL (shown once after creation) ============ */}
      {showRawKeyModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative rounded-xl border border-amber-300 shadow-2xl w-full max-w-lg z-[101]"
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-amber-200 bg-amber-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h2 className="text-lg font-bold text-amber-800">Save Your API Key Now</h2>
              </div>
              <button
                onClick={() => setShowRawKeyModal(null)}
                className="p-1.5 rounded hover:bg-amber-100 text-amber-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium mb-1">
                  ⚠️ This is the ONLY time you'll see this key.
                </p>
                <p className="text-xs text-amber-700">
                  We store only a SHA-256 hash — we cannot recover the key if you lose it.
                  Copy it now and store it securely (e.g. password manager).
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  API Key for "{showRawKeyModal.name}"
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={showRawKeyModal.rawKey}
                    readOnly
                    className="flex-1 px-3 py-2 bg-muted border border-border rounded-lg text-sm font-mono"
                  />
                  <button
                    onClick={() => handleCopyKey(showRawKeyModal.rawKey)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-muted/30 rounded-lg border border-border">
                <p className="text-xs font-medium text-muted-foreground mb-1">How to use this key:</p>
                <p className="text-xs text-muted-foreground">
                  Include in API requests as a Bearer token:
                </p>
                <code className="text-xs font-mono bg-muted px-2 py-1 rounded block mt-1">
                  Authorization: Bearer {showRawKeyModal.rawKey.slice(0, 16)}...
                </code>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200" style={{ backgroundColor: '#ffffff' }}>
              <button
                onClick={() => setShowRawKeyModal(null)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                I've Saved the Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// API KEY EDITOR MODAL
// =====================================================================
function ApiKeyEditor({
  apiKey,
  scopeConfigs,
  onClose,
  onSave,
  saving,
}: {
  apiKey: any
  scopeConfigs: any[]
  onClose: () => void
  onSave: (data: any) => void
  saving: boolean
}) {
  const [name, setName] = useState(apiKey?.name || '')
  const [partnerId, setPartnerId] = useState(apiKey?.partnerId || '')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(apiKey?.scopes || ['read_leads'])
  const [expiresAt, setExpiresAt] = useState(
    apiKey?.expiresAt ? new Date(apiKey.expiresAt).toISOString().slice(0, 10) : ''
  )
  const [status, setStatus] = useState(apiKey?.status || 'active')

  const isEditing = !!apiKey

  const handleScopeToggle = (scope: string) => {
    if (scope === 'admin') {
      // Admin scope grants all — confirm before granting
      if (!selectedScopes.includes('admin')) {
        if (!confirm('The "admin" scope grants FULL access to all endpoints. This is dangerous. Continue?')) {
          return
        }
        setSelectedScopes(['admin']) // admin implies all
      } else {
        setSelectedScopes(selectedScopes.filter(s => s !== 'admin'))
      }
    } else {
      // Toggle individual scope (remove admin if present)
      if (selectedScopes.includes(scope)) {
        setSelectedScopes(selectedScopes.filter(s => s !== scope))
      } else {
        setSelectedScopes([...selectedScopes.filter(s => s !== 'admin'), scope])
      }
    }
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (selectedScopes.length === 0) {
      toast.error('At least 1 scope is required')
      return
    }

    onSave({
      name,
      partnerId: partnerId || null,
      scopes: selectedScopes,
      expiresAt: expiresAt || null,
      ...(isEditing && { status }),
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
            {isEditing ? 'Edit API Key' : 'New API Key'}
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
              placeholder="e.g. Bajaj Production Key"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Partner (optional)</label>
            <input
              type="text"
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              placeholder="Partner ID (leave empty for internal key)"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Get partner ID from the Partners page. Leave empty for internal/admin keys.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">Scopes *</label>
            <div className="space-y-2">
              {scopeConfigs.map((s: any) => (
                <label
                  key={s.key}
                  className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${
                    selectedScopes.includes(s.key)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/30'
                  } ${s.key === 'admin' ? 'border-red-200' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(s.key)}
                    onChange={() => handleScopeToggle(s.key)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono">{s.key}</code>
                      <span className="text-sm font-medium">{s.label}</span>
                      {s.key === 'admin' && <Badge variant="danger">DANGEROUS</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Expires At</label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">Empty = never expires</p>
            </div>
            {isEditing && (
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="active">Active</option>
                  <option value="revoked">Revoked</option>
                </select>
              </div>
            )}
          </div>

          {!isEditing && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-800">
                ⚠️ The full API key will be shown <strong>ONCE</strong> after creation.
                You must save it immediately — we cannot recover it later (only SHA-256 hash is stored).
              </p>
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
            {isEditing ? 'Update Key' : 'Create Key'}
          </button>
        </div>
      </div>
    </div>
  )
}
