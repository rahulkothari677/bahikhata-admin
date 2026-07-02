'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Star, Plus, Edit3, Trash2, X, Save, Loader2, TrendingUp,
  Clock, Activity, Eye, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const TRIGGER_LABELS: Record<string, string> = {
  days_after_signup: 'Days After Signup',
  transaction_count: 'Transaction Count',
  days_since_last_survey: 'Days Since Last Survey',
  plan_upgrade: 'Plan Upgrade',
  manual: 'Manual (Admin Trigger)',
}

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  days_after_signup: 'Show survey X days after user creates account',
  transaction_count: 'Show survey after user makes X transactions',
  days_since_last_survey: 'Show if user hasn\'t seen survey in X days',
  plan_upgrade: 'Show immediately when user upgrades plan',
  manual: 'Only show when admin manually triggers (bulk job)',
}

export default function NpsConfigPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [showEditor, setShowEditor] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-nps-config-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/nps-config?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-nps-config-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/nps-config?tab=list')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const isEdit = !!data.id
      const url = isEdit ? `/api/admin/nps-config/${data.id}` : '/api/admin/nps-config'
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
      toast.success('Config saved')
      queryClient.invalidateQueries({ queryKey: ['admin-nps-config-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-nps-config-overview'] })
      setShowEditor(false)
      setEditing(null)
    },
    onError: (err: Error) => toast.error('Save failed', { description: err.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/nps-config/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    onSuccess: () => {
      toast.success('Config deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-nps-config-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-nps-config-overview'] })
    },
    onError: () => toast.error('Delete failed'),
  })

  const ov = overview?.overview || {}
  const configs = listData?.configs || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="NPS Survey Builder"
        description="Configure when NPS surveys appear to users · 5 trigger types · cooldown protection"
        actions={
          <button
            onClick={() => { setEditing(null); setShowEditor(true) }}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            New Survey Config
          </button>
        }
      />

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Configs', icon: Star },
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
                <KPICard
                  label="Active Configs"
                  value={formatNumber(ov.enabledCount || 0)}
                  icon={Star}
                  iconColor="text-amber-600"
                  sublabel={`${ov.disabledCount || 0} disabled`}
                />
                <KPICard
                  label="Times Shown"
                  value={formatNumber(ov.totalShown || 0)}
                  icon={Eye}
                  iconColor="text-blue-600"
                  sublabel="Total survey impressions"
                />
                <KPICard
                  label="Times Responded"
                  value={formatNumber(ov.totalResponded || 0)}
                  icon={Activity}
                  iconColor="text-emerald-600"
                  sublabel="User responses"
                />
                <KPICard
                  label="Response Rate"
                  value={`${ov.responseRate || 0}%`}
                  icon={TrendingUp}
                  iconColor="text-violet-600"
                  sublabel="Responded / Shown"
                />
              </KPIGrid>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How NPS survey triggers work (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">5 Trigger Types:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Days After Signup</strong>: show X days after account creation</li>
                      <li>• <strong>Transaction Count</strong>: show after Xth transaction</li>
                      <li>• <strong>Days Since Last Survey</strong>: re-survey after X days</li>
                      <li>• <strong>Plan Upgrade</strong>: immediate on upgrade</li>
                      <li>• <strong>Manual</strong>: admin triggers via bulk job</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Cooldown + Targeting:</p>
                    <ul className="space-y-0.5">
                      <li>• <strong>Cooldown</strong>: don't re-show for X days after response (default: 90)</li>
                      <li>• <strong>Target plans</strong>: all, free, pro, or elite</li>
                      <li>• <strong>Priority</strong>: higher = shown first if multiple triggers match</li>
                      <li>• Main app checks rules on each page load</li>
                      <li>• Responses stored in NpsFeedback table (existing)</li>
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
        <ContentCard title={`Survey Configs — ${configs.length} total`}>
          {listLoading ? (
            <LoadingSkeleton rows={6} />
          ) : configs.length === 0 ? (
            <EmptyState icon={Star} title="No survey configs" description="Click 'New Survey Config' to create one" />
          ) : (
            <div className="divide-y divide-border">
              {configs.map((c: any) => (
                <div key={c.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${c.enabled ? 'bg-amber-100 dark:bg-amber-950/30' : 'bg-muted'}`}>
                    <Star className={`w-5 h-5 ${c.enabled ? 'text-amber-600' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-medium">{c.name}</p>
                      <Badge variant={c.enabled ? 'success' : 'neutral'}>{c.enabled ? 'enabled' : 'disabled'}</Badge>
                      <Badge variant="info">{TRIGGER_LABELS[c.triggerType] || c.triggerType}</Badge>
                      <Badge variant="neutral">Priority: {c.priority}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {TRIGGER_DESCRIPTIONS[c.triggerType]} — value: <strong>{c.triggerValue}</strong>
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>Cooldown: {c.cooldownDays}d</span>
                      <span>· Target: {c.targetPlans}</span>
                      <span>· Shown: {c.timesShown}</span>
                      <span>· Responded: {c.timesResponded}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditing(c); setShowEditor(true) }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id) }}
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
      )}

      {/* EDITOR MODAL */}
      {showEditor && (
        <ConfigEditor
          config={editing}
          onClose={() => { setShowEditor(false); setEditing(null) }}
          onSave={(data) => saveMutation.mutate(data)}
          saving={saveMutation.isPending}
        />
      )}
    </div>
  )
}

function ConfigEditor({ config, onClose, onSave, saving }: { config: any; onClose: () => void; onSave: (data: any) => void; saving: boolean }) {
  const [name, setName] = useState(config?.name || '')
  const [triggerType, setTriggerType] = useState(config?.triggerType || 'days_after_signup')
  const [triggerValue, setTriggerValue] = useState(config?.triggerValue?.toString() || '7')
  const [question, setQuestion] = useState(config?.question || 'How likely are you to recommend BahiKhata Pro to a friend or colleague?')
  const [cooldownDays, setCooldownDays] = useState(config?.cooldownDays?.toString() || '90')
  const [targetPlans, setTargetPlans] = useState(config?.targetPlans || 'all')
  const [enabled, setEnabled] = useState(config?.enabled !== false)
  const [priority, setPriority] = useState(config?.priority?.toString() || '1')

  const handleSave = () => {
    if (!name.trim()) { toast.error('Name is required'); return }
    onSave({
      id: config?.id,
      name,
      triggerType,
      triggerValue: parseInt(triggerValue, 10),
      question,
      cooldownDays: parseInt(cooldownDays, 10),
      targetPlans,
      enabled,
      priority: parseInt(priority, 10),
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto z-[101]" style={{ backgroundColor: '#ffffff', color: '#0f172a' }}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>{config ? 'Edit Survey Config' : 'New Survey Config'}</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 7-Day Onboarding Survey" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Trigger Type *</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Trigger Value *</label>
              <input type="number" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} min="1" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-[10px] text-muted-foreground mt-0.5">{triggerType === 'transaction_count' ? 'Number of transactions' : 'Number of days'}</p>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Survey Question</label>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Cooldown (days)</label>
              <input type="number" value={cooldownDays} onChange={(e) => setCooldownDays(e.target.value)} min="1" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Target Plans</label>
              <select value={targetPlans} onChange={(e) => setTargetPlans(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="all">All Plans</option>
                <option value="free">Free Only</option>
                <option value="pro">Pro Only</option>
                <option value="elite">Elite Only</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Priority</label>
              <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} min="1" max="10" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
          <label className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg border border-border">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="text-sm font-medium">Enabled (survey will be shown to users)</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 sticky bottom-0 z-10" style={{ backgroundColor: '#ffffff' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {config ? 'Update Config' : 'Create Config'}
          </button>
        </div>
      </div>
    </div>
  )
}
