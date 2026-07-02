'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Download, Plus, X, Save, Loader2, Trash2, Play,
  TrendingUp, CheckCircle2, XCircle, Clock, FileBarChart, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const TYPE_LABELS: Record<string, string> = {
  user_data: 'Single User Data',
  all_users: 'All Users',
  transactions: 'Transactions',
  subscriptions: 'Subscriptions',
  ai_usage: 'AI Usage Logs',
  custom: 'Custom SQL Query',
}

const STATUS_BADGE: Record<string, 'warning' | 'info' | 'success' | 'danger'> = {
  pending: 'warning',
  processing: 'info',
  completed: 'success',
  failed: 'danger',
}

export default function DataExportsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'failed'>('all')
  const [showEditor, setShowEditor] = useState(false)

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-data-exports-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/data-exports?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-data-exports-list', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ tab: 'list', page: String(page), status: statusFilter })
      const r = await fetch(`/api/admin/data-exports?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  const generateMutation = useMutation({
    mutationFn: async ({ id, type, userId, customQuery }: { id: string; type: string; userId?: string; customQuery?: string }) => {
      // For generate, we call the generate endpoint which returns the CSV directly
      const r = await fetch('/api/admin/data-exports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      }
      // If response is CSV (not JSON), download it
      const contentType = r.headers.get('content-type') || ''
      if (contentType.includes('text/csv')) {
        const blob = await r.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = r.headers.get('content-disposition')?.split('filename="')[1]?.replace('"', '') || `export_${id}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return { success: true, downloaded: true }
      }
      return r.json()
    },
    onSuccess: (data) => {
      toast.success(data.downloaded ? 'Export generated — file downloaded' : 'Export processed')
      queryClient.invalidateQueries({ queryKey: ['admin-data-exports-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-data-exports-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Export failed', { description: err.message })
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch('/api/admin/data-exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`)
      return result
    },
    onSuccess: (data) => {
      toast.success('Export requested — generating now...')
      // Auto-generate the export immediately
      generateMutation.mutate({
        id: data.export.id,
        type: data.export.type,
        userId: data.export.userId,
        customQuery: data.export.customQuery,
      })
      setShowEditor(false)
    },
    onError: (err: Error) => {
      toast.error('Request failed', { description: err.message })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/data-exports/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    onSuccess: () => {
      toast.success('Export deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-data-exports-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-data-exports-overview'] })
    },
    onError: () => toast.error('Delete failed'),
  })

  const ov = overview?.overview || {}
  const exports = listData?.exports || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Data Export Center"
        description="GDPR/DPDP-compliant data exports · 6 export types · CSV download · 24h link expiry"
        actions={
          <button
            onClick={() => setShowEditor(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            New Export
          </button>
        }
      />

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Exports', icon: FileBarChart },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW TAB */}
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
                <KPICard label="Pending" value={formatNumber(ov.pendingCount || 0)} icon={Clock} iconColor="text-amber-600" sublabel="Waiting to process" />
                <KPICard label="Completed" value={formatNumber(ov.completedCount || 0)} icon={CheckCircle2} iconColor="text-emerald-600" sublabel="Ready for download" />
                <KPICard label="Failed" value={formatNumber(ov.failedCount || 0)} icon={XCircle} iconColor="text-red-600" sublabel="Generation errors" />
                <KPICard label="Total Rows Exported" value={formatNumber(ov.totalRows || 0)} icon={Download} iconColor="text-violet-600" sublabel="Across all exports" />
              </KPIGrid>

              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How data exports work (GDPR/DPDP compliant)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">6 Export Types:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Single User Data</strong>: complete user profile + transactions + products + parties</li>
                      <li>• <strong>All Users</strong>: user list (for migration/analysis)</li>
                      <li>• <strong>Transactions</strong>: all transactions (for accounting)</li>
                      <li>• <strong>Subscriptions</strong>: payment history (for revenue)</li>
                      <li>• <strong>AI Usage</strong>: AI call logs (for cost analysis)</li>
                      <li>• <strong>Custom SQL</strong>: custom query export (uses safe query runner)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Compliance + Safety:</p>
                    <ul className="space-y-0.5">
                      <li>• GDPR Article 20: Right to data portability</li>
                      <li>• DPDP Act: Right to access personal data</li>
                      <li>• Max 10,000 rows per export (prevents memory exhaustion)</li>
                      <li>• Download links expire after 24 hours</li>
                      <li>• All exports logged to AdminAction audit trail</li>
                      <li>• Custom queries use safe query runner (SELECT only)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* LIST TAB */}
      {tab === 'list' && (
        <>
          <div className="flex items-center gap-2">
            {(['all', 'pending', 'completed', 'failed'] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                  statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <ContentCard title={`Data Exports — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : exports.length === 0 ? (
              <EmptyState icon={Download} title="No exports yet" description="Click 'New Export' to generate one" />
            ) : (
              <div className="divide-y divide-border">
                {exports.map((e: any) => (
                  <div key={e.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      e.status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-950/30' :
                      e.status === 'failed' ? 'bg-red-100 dark:bg-red-950/30' :
                      'bg-amber-100 dark:bg-amber-950/30'
                    }`}>
                      {e.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> :
                       e.status === 'failed' ? <XCircle className="w-5 h-5 text-red-600" /> :
                       <Clock className="w-5 h-5 text-amber-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-sm font-medium">{TYPE_LABELS[e.type] || e.type}</p>
                        <Badge variant={STATUS_BADGE[e.status] || 'neutral'}>{e.status}</Badge>
                        <Badge variant="neutral">{e.format}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {e.fileName && <span className="font-mono">{e.fileName}</span>}
                        {e.rowCount > 0 && <span>· {formatNumber(e.rowCount)} rows</span>}
                        {e.fileSizeBytes > 0 && <span>· {(e.fileSizeBytes / 1024).toFixed(1)} KB</span>}
                        <span>· {formatRelativeTime(e.createdAt)}</span>
                        {e.userId && <span>· User: {e.userId.slice(0, 8)}…</span>}
                      </div>
                      {e.errorMessage && <p className="text-xs text-red-600 mt-1">⚠ {e.errorMessage}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      {e.status === 'pending' && (
                        <button
                          onClick={() => generateMutation.mutate({ id: e.id, type: e.type, userId: e.userId, customQuery: e.customQuery })}
                          disabled={generateMutation.isPending}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
                        >
                          {generateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          Generate
                        </button>
                      )}
                      <button
                        onClick={() => { if (confirm('Delete this export?')) deleteMutation.mutate(e.id) }}
                        className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ContentCard>

          {total > 0 && (
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          )}
        </>
      )}

      {/* EDITOR MODAL */}
      {showEditor && (
        <ExportEditor
          onClose={() => setShowEditor(false)}
          onCreate={(data) => createMutation.mutate(data)}
          saving={createMutation.isPending || generateMutation.isPending}
        />
      )}
    </div>
  )
}

function ExportEditor({ onClose, onCreate, saving }: { onClose: () => void; onCreate: (data: any) => void; saving: boolean }) {
  const [type, setType] = useState('all_users')
  const [format, setFormat] = useState('csv')
  const [userId, setUserId] = useState('')
  const [customQuery, setCustomQuery] = useState('')

  const handleCreate = () => {
    if (type === 'user_data' && !userId.trim()) { toast.error('User ID is required for user_data export'); return }
    if (type === 'custom' && !customQuery.trim()) { toast.error('SQL query is required for custom export'); return }
    onCreate({ type, format, userId: userId || null, customQuery: customQuery || null })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-lg z-[101]" style={{ backgroundColor: '#ffffff', color: '#0f172a' }}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>New Data Export</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Export Type *</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="csv">CSV</option>
            </select>
          </div>
          {type === 'user_data' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">User ID *</label>
              <input type="text" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="cmd..." className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Get from Users page</p>
            </div>
          )}
          {type === 'custom' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">SQL Query (SELECT only) *</label>
              <textarea value={customQuery} onChange={(e) => setCustomQuery(e.target.value)} rows={4} placeholder={'SELECT * FROM "User" LIMIT 100'} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Validated via safe query runner (SELECT only, max 1000 rows)</p>
            </div>
          )}
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              💡 Export will be generated immediately and downloaded as a CSV file.
              Max 10,000 rows per export. All exports are logged to the audit trail.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Generate Export
          </button>
        </div>
      </div>
    </div>
  )
}
