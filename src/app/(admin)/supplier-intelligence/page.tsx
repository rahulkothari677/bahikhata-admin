'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Package, Plus, X, Loader2, TrendingUp, Wallet,
  BarChart3, FileBarChart, Trash2, Eye, Download, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'list'

const STATUS_BADGE: Record<string, 'success' | 'info' | 'neutral'> = {
  generated: 'success',
  delivered: 'info',
  archived: 'neutral',
}

export default function SupplierIntelligencePage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [showEditor, setShowEditor] = useState(false)
  const [expandedReport, setExpandedReport] = useState<string | null>(null)

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-supplier-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/supplier-intelligence?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-supplier-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/supplier-intelligence?tab=list')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  const generateMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch('/api/admin/supplier-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`)
      return result
    },
    onSuccess: (data) => {
      toast.success('Report generated', { description: data.summary })
      queryClient.invalidateQueries({ queryKey: ['admin-supplier-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-supplier-overview'] })
      setShowEditor(false)
    },
    onError: (err: Error) => toast.error('Generation failed', { description: err.message }),
  })

  const ov = overview?.overview || {}
  const reportTypes = overview?.reportTypes || []
  const reports = listData?.reports || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Supplier Intelligence"
        description="Anonymized market data reports for FMCG partners · aggregated across all users · DPDP compliant"
        actions={
          <button
            onClick={() => setShowEditor(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Generate Report
          </button>
        }
      />

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Reports', icon: FileBarChart },
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
                <KPICard label="Total Reports" value={formatNumber(ov.totalCount || 0)} icon={FileBarChart} iconColor="text-violet-600" sublabel={`${ov.generatedCount || 0} generated · ${ov.deliveredCount || 0} delivered`} />
                <KPICard label="Revenue Potential" value={formatINR(ov.totalRevenue || 0)} icon={Wallet} iconColor="text-emerald-600" sublabel="From all reports" />
                <KPICard label="Report Types" value={String(reportTypes.length)} icon={BarChart3} iconColor="text-blue-600" sublabel="Available report types" />
                <KPICard label="Delivered" value={formatNumber(ov.deliveredCount || 0)} icon={Package} iconColor="text-amber-600" sublabel="Sent to partners" />
              </KPIGrid>

              {/* Available report types */}
              <ContentCard title="Available Report Types">
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {reportTypes.map((rt: any) => (
                    <div key={rt.key} className="p-3 bg-muted/30 rounded-lg border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{rt.label}</p>
                        <Badge variant="success">{formatINR(rt.suggestedPrice)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{rt.description}</p>
                    </div>
                  ))}
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How supplier intelligence works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Report Generation:</p>
                    <ul className="space-y-0.5">
                      <li>• Aggregates data across ALL users (no individual data)</li>
                      <li>• 4 report types: product trends, transaction volume, payment patterns, category analysis</li>
                      <li>• Uses bulk groupBy + raw SQL (not per-user queries)</li>
                      <li>• Minimum 10 users per data point (suppressed if less)</li>
                      <li>• Reports sold to FMCG partners (₹30K-₹1L per report)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Privacy + Compliance:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Fully anonymized</strong>: no user IDs, emails, or PII</li>
                      <li>• <strong>Aggregated only</strong>: counts, sums, averages</li>
                      <li>• <strong>DPDP compliant</strong>: data is anonymized, not personal</li>
                      <li>• Partner receives report (not raw data)</li>
                      <li>• All report generation logged to audit trail</li>
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
        <ContentCard title={`Supplier Reports — ${reports.length} total`}>
          {listLoading ? (
            <LoadingSkeleton rows={6} />
          ) : reports.length === 0 ? (
            <EmptyState icon={FileBarChart} title="No reports generated" description="Click 'Generate Report' to create one" />
          ) : (
            <div className="divide-y divide-border">
              {reports.map((r: any) => (
                <div key={r.id}>
                  <button
                    onClick={() => setExpandedReport(expandedReport === r.id ? null : r.id)}
                    className="w-full text-left p-4 hover:bg-muted/30 transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-950/30 flex items-center justify-center flex-shrink-0">
                        <FileBarChart className="w-5 h-5 text-violet-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-medium">{r.name}</p>
                          <Badge variant={STATUS_BADGE[r.status] || 'neutral'}>{r.status}</Badge>
                          <Badge variant="info">{r.type.replace(/_/g, ' ')}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{r.summary}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{formatNumber(r.dataPoints)} data points</span>
                          <span>· {formatNumber(r.userCount)} users</span>
                          <span>· {formatINR(r.priceInr)}</span>
                          {r.partnerName && <span>· {r.partnerName}</span>}
                          <span>· {formatRelativeTime(r.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded data */}
                  {expandedReport === r.id && (
                    <div className="bg-muted/20 p-4 border-t border-border">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Report Data</p>
                      <pre className="text-xs font-mono bg-background border border-border rounded p-3 overflow-x-auto max-h-96">
                        {JSON.stringify(r.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ContentCard>
      )}

      {/* EDITOR MODAL */}
      {showEditor && (
        <ReportEditor
          reportTypes={reportTypes}
          onClose={() => setShowEditor(false)}
          onGenerate={(data) => generateMutation.mutate(data)}
          saving={generateMutation.isPending}
        />
      )}
    </div>
  )
}

function ReportEditor({ reportTypes, onClose, onGenerate, saving }: { reportTypes: any[]; onClose: () => void; onGenerate: (data: any) => void; saving: boolean }) {
  const [type, setType] = useState('product_trends')
  const [name, setName] = useState('')
  const [partnerId, setPartnerId] = useState('')
  const [priceInr, setPriceInr] = useState('')

  const handleGenerate = () => {
    if (!name.trim()) { toast.error('Name is required'); return }
    onGenerate({ type, name, partnerId: partnerId || null, priceInr: priceInr ? parseFloat(priceInr) : undefined })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-md z-[101]" style={{ backgroundColor: '#ffffff', color: '#0f172a' }}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>Generate Report</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Report Type *</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              {reportTypes.map((rt: any) => <option key={rt.key} value={rt.key}>{rt.label} ({formatINR(rt.suggestedPrice)})</option>)}
            </select>
            <p className="text-[10px] text-muted-foreground mt-0.5">{reportTypes.find((rt: any) => rt.key === type)?.description}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Report Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q2 2026 Product Trends" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Partner ID (optional)</label>
              <input type="text" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} placeholder="For specific partner" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Price (₹)</label>
              <input type="number" value={priceInr} onChange={(e) => setPriceInr(e.target.value)} placeholder={String(reportTypes.find((rt: any) => rt.key === type)?.suggestedPrice || 0)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              🔒 Report data is fully anonymized (aggregated across all users, no PII). DPDP compliant.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80">Cancel</button>
          <button onClick={handleGenerate} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Generate
          </button>
        </div>
      </div>
    </div>
  )
}
