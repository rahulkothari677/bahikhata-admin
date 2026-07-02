'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Swords, Plus, Edit3, Trash2, X, Save, Loader2, Globe,
  TrendingUp, AlertCircle, ExternalLink, Clock, ChevronDown, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'list'

// Standard features for comparison
const FEATURE_LIST = [
  'AI Bill Scanner',
  'Voice Entry',
  'GST Filing',
  'Credit Scoring',
  'Multi-language',
  'Offline Mode',
  'Inventory',
  'WhatsApp Integration',
  'Payment Reminders',
  'Profit Tracking',
]

export default function CompetitorsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showEditor, setShowEditor] = useState(false)
  const [editingCompetitor, setEditingCompetitor] = useState<any>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-competitors-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/competitors?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-competitors-list', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ tab: 'list', status: statusFilter })
      const r = await fetch(`/api/admin/competitors?${params}`)
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
      const url = isEdit ? `/api/admin/competitors/${data.id}` : '/api/admin/competitors'
      const r = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`)
      return result
    },
    onSuccess: () => {
      toast.success('Competitor saved')
      queryClient.invalidateQueries({ queryKey: ['admin-competitors-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-competitors-overview'] })
      setShowEditor(false)
      setEditingCompetitor(null)
    },
    onError: (err: Error) => {
      toast.error('Save failed', { description: err.message })
    },
  })

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/competitors/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Competitor deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-competitors-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-competitors-overview'] })
    },
    onError: (err: Error) => {
      toast.error('Delete failed', { description: err.message })
    },
  })

  const ov = overview?.overview || {}
  const competitors = listData?.competitors || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Competitor Monitoring"
        description="Track competing apps' pricing, features, and market positioning"
        actions={
          <button
            onClick={() => { setEditingCompetitor(null); setShowEditor(true) }}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Competitor
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Competitors', icon: Swords },
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
              <LoadingSkeleton rows={6} />
            </>
          ) : !overview?.success ? (
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Active Competitors"
                  value={String(ov.activeCount || 0)}
                  icon={Swords}
                  iconColor="text-red-600"
                  sublabel={`${ov.inactiveCount || 0} inactive`}
                />
                <KPICard
                  label="Updates (30 days)"
                  value={String(ov.updateCount30d || 0)}
                  icon={Clock}
                  iconColor="text-blue-600"
                  sublabel="Pricing/feature changes tracked"
                />
                <KPICard
                  label="Total Tracked"
                  value={String(ov.totalCount || 0)}
                  icon={TrendingUp}
                  iconColor="text-violet-600"
                  sublabel="All competitors"
                />
                <KPICard
                  label="Bahikhata Pro"
                  value="You"
                  icon={Globe}
                  iconColor="text-emerald-600"
                  sublabel="Your position"
                />
              </KPIGrid>

              {/* Pricing comparison table */}
              {overview.competitors?.length > 0 && (
                <ContentCard title="Pricing Comparison">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b border-border">
                        <tr>
                          <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Competitor</th>
                          <th className="text-center text-xs font-medium text-muted-foreground uppercase px-4 py-3">Free</th>
                          <th className="text-center text-xs font-medium text-muted-foreground uppercase px-4 py-3">Pro</th>
                          <th className="text-center text-xs font-medium text-muted-foreground uppercase px-4 py-3">Elite</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {/* Bahikhata Pro row (our pricing) */}
                        <tr className="bg-emerald-50 dark:bg-emerald-950/20 font-medium">
                          <td className="px-4 py-3">
                            <span className="text-emerald-700 dark:text-emerald-300">🏆 Bahikhata Pro (You)</span>
                          </td>
                          <td className="px-4 py-3 text-center">₹0</td>
                          <td className="px-4 py-3 text-center">₹299/mo</td>
                          <td className="px-4 py-3 text-center">₹599/mo</td>
                        </tr>
                        {overview.competitors.map((c: any) => (
                          <tr key={c.id} className="hover:bg-muted/30">
                            <td className="px-4 py-3">
                              {c.website ? (
                                <a href={c.website} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                                  {c.name}
                                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                </a>
                              ) : (
                                c.name
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">{c.freePrice || '—'}</td>
                            <td className="px-4 py-3 text-center">{c.proPrice || '—'}</td>
                            <td className="px-4 py-3 text-center">{c.elitePrice || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ContentCard>
              )}

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How competitor monitoring works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">What to Track:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Pricing</strong>: Free, Pro, Elite tier prices (₹/month)</li>
                      <li>• <strong>Features</strong>: 10 standard features (AI scanner, voice, GST, etc.)</li>
                      <li>• <strong>Target market</strong>: Who they serve (kirana, restaurants, etc.)</li>
                      <li>• <strong>USP</strong>: Their unique selling proposition</li>
                      <li>• <strong>Weaknesses</strong>: Gaps we can exploit</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Update Tracking:</p>
                    <ul className="space-y-0.5">
                      <li>• Every field change logged as <code className="text-[11px] bg-muted px-1 rounded">CompetitorUpdate</code></li>
                      <li>• Timeline shows: field, old value, new value, when, who</li>
                      <li>• Pricing changes visible at a glance in comparison table</li>
                      <li>• Update periodically (monthly recommended)</li>
                      <li>• All changes logged to AdminAction audit trail</li>
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
            {(['all', 'active', 'inactive'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
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

          <ContentCard title={`Competitors — ${competitors.length} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={6} />
            ) : competitors.length === 0 ? (
              <EmptyState
                icon={Swords}
                title="No competitors tracked"
                description="Click 'New Competitor' to add your first competitor"
              />
            ) : (
              <div className="divide-y divide-border">
                {competitors.map((c: any) => (
                  <div key={c.id}>
                    <button
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                      className="w-full text-left p-4 hover:bg-muted/30 transition"
                    >
                      <div className="flex items-start gap-3">
                        {expanded === c.id ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-sm font-medium">{c.name}</p>
                            <Badge variant={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</Badge>
                            {c.targetMarket && <Badge variant="info">{c.targetMarket}</Badge>}
                          </div>
                          {c.description && (
                            <p className="text-xs text-muted-foreground mb-1">{c.description}</p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>Free: {c.freePrice || '—'}</span>
                            <span>Pro: {c.proPrice || '—'}</span>
                            <span>Elite: {c.elitePrice || '—'}</span>
                            <span>· {c.updateCount} updates</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingCompetitor(c); setShowEditor(true) }}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id)
                            }}
                            className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {expanded === c.id && (
                      <div className="bg-muted/20 p-4 border-t border-border space-y-4">
                        {/* Feature comparison */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Features</p>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            {FEATURE_LIST.map(f => {
                              const has = c.features[f]
                              return (
                                <div key={f} className={`p-2 rounded text-xs text-center ${has ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground line-through'}`}>
                                  {f}
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* USP + Weaknesses */}
                        {(c.usp || c.weaknesses) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {c.usp && (
                              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase mb-1">Their USP</p>
                                <p className="text-sm">{c.usp}</p>
                              </div>
                            )}
                            {c.weaknesses && (
                              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-900">
                                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase mb-1">Our Opportunities (Their Weaknesses)</p>
                                <p className="text-sm">{c.weaknesses}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ContentCard>
        </>
      )}

      {/* ============ EDITOR MODAL ============ */}
      {showEditor && (
        <CompetitorEditor
          competitor={editingCompetitor}
          onClose={() => { setShowEditor(false); setEditingCompetitor(null) }}
          onSave={(data) => saveMutation.mutate(data)}
          saving={saveMutation.isPending}
        />
      )}
    </div>
  )
}

// =====================================================================
// COMPETITOR EDITOR MODAL
// =====================================================================
function CompetitorEditor({
  competitor,
  onClose,
  onSave,
  saving,
}: {
  competitor: any
  onClose: () => void
  onSave: (data: any) => void
  saving: boolean
}) {
  const [name, setName] = useState(competitor?.name || '')
  const [website, setWebsite] = useState(competitor?.website || '')
  const [description, setDescription] = useState(competitor?.description || '')
  const [freePrice, setFreePrice] = useState(competitor?.freePrice || '')
  const [proPrice, setProPrice] = useState(competitor?.proPrice || '')
  const [elitePrice, setElitePrice] = useState(competitor?.elitePrice || '')
  const [features, setFeatures] = useState<Record<string, boolean>>(competitor?.features || {})
  const [targetMarket, setTargetMarket] = useState(competitor?.targetMarket || '')
  const [usp, setUsp] = useState(competitor?.usp || '')
  const [weaknesses, setWeaknesses] = useState(competitor?.weaknesses || '')
  const [status, setStatus] = useState(competitor?.status || 'active')

  const handleFeatureToggle = (feature: string) => {
    setFeatures({ ...features, [feature]: !features[feature] })
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    onSave({
      id: competitor?.id,
      name,
      website: website || null,
      description: description || null,
      freePrice: freePrice || null,
      proPrice: proPrice || null,
      elitePrice: elitePrice || null,
      features,
      targetMarket: targetMarket || null,
      usp: usp || null,
      weaknesses: weaknesses || null,
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
        className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto z-[101]"
        style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>
            {competitor ? 'Edit Competitor' : 'New Competitor'}
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
              placeholder="e.g. Khatabook"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Website</label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://khatabook.com"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Target Market</label>
              <input
                type="text"
                value={targetMarket}
                onChange={(e) => setTargetMarket(e.target.value)}
                placeholder="e.g. Small kirana stores"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Brief description of the competitor"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pricing (₹)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Free Tier</label>
                <input
                  type="text"
                  value={freePrice}
                  onChange={(e) => setFreePrice(e.target.value)}
                  placeholder="₹0"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Pro Tier</label>
                <input
                  type="text"
                  value={proPrice}
                  onChange={(e) => setProPrice(e.target.value)}
                  placeholder="₹499/mo"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Elite Tier</label>
                <input
                  type="text"
                  value={elitePrice}
                  onChange={(e) => setElitePrice(e.target.value)}
                  placeholder="₹999/mo"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Features</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {FEATURE_LIST.map(f => (
                <label
                  key={f}
                  className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${
                    features[f]
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!features[f]}
                    onChange={() => handleFeatureToggle(f)}
                  />
                  <span className="text-xs">{f}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Their USP (Unique Selling Proposition)</label>
              <textarea
                value={usp}
                onChange={(e) => setUsp(e.target.value)}
                rows={2}
                placeholder="What makes them stand out?"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Their Weaknesses (Our Opportunities)</label>
              <textarea
                value={weaknesses}
                onChange={(e) => setWeaknesses(e.target.value)}
                rows={2}
                placeholder="What do they lack that we have?"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {competitor && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
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
            {competitor ? 'Update Competitor' : 'Create Competitor'}
          </button>
        </div>
      </div>
    </div>
  )
}
