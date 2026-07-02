'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Flag, Plus, Search, X, Loader2, TrendingUp, History,
  CheckCircle2, XCircle, Clock,
} from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

export default function FeaturesPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newFlag, setNewFlag] = useState({ key: '', label: '', description: '' })

  // ============ OVERVIEW DATA ============
  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-features-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/features?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-features-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/features?tab=list')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const r = await fetch(`/api/admin/features/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      sonnerToast.success(data.message || 'Feature toggled')
      queryClient.invalidateQueries({ queryKey: ['admin-features-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-features-overview'] })
    },
    onError: (err: Error) => {
      sonnerToast.error('Failed to toggle feature', { description: err.message, duration: 8000 })
    },
  })

  const createMutation = useMutation({
    mutationFn: async (flag: typeof newFlag) => {
      const r = await fetch(`/api/admin/features/${flag.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flag),
      })
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    onSuccess: () => {
      sonnerToast.success('Feature flag created')
      setShowCreate(false)
      setNewFlag({ key: '', label: '', description: '' })
      queryClient.invalidateQueries({ queryKey: ['admin-features-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-features-overview'] })
    },
    onError: () => sonnerToast.error('Failed to create flag'),
  })

  const ov = overviewData?.overview || {}
  const recentToggles = overviewData?.recentToggles || []
  const allFlags = listData?.flags || []
  const filtered = search
    ? allFlags.filter((f: any) => f.key.includes(search) || f.label.toLowerCase().includes(search.toLowerCase()))
    : allFlags

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Feature Flags"
        description="Toggle features on/off instantly + adoption analytics · no deployment needed"
        actions={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Flag
          </button>
        }
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Flags', icon: Flag },
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
          ) : !overviewData?.success ? (
            <EmptyState icon={Flag} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Enabled Flags"
                  value={formatNumber(ov.enabledCount || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.disabledCount || 0} disabled`}
                />
                <KPICard
                  label="Total Flags"
                  value={formatNumber(ov.totalCount || 0)}
                  icon={Flag}
                  iconColor="text-blue-600"
                  sublabel="All feature flags"
                />
                <KPICard
                  label="Toggles (30 days)"
                  value={formatNumber(ov.toggleCount30d || 0)}
                  icon={History}
                  iconColor="text-violet-600"
                  sublabel="Flag changes in last month"
                />
                <KPICard
                  label="Disabled"
                  value={formatNumber(ov.disabledCount || 0)}
                  icon={XCircle}
                  iconColor="text-red-600"
                  sublabel="Currently OFF"
                />
              </KPIGrid>

              {/* Recent toggle history */}
              <ContentCard title="Recent Toggle History (Last 10)">
                {recentToggles.length === 0 ? (
                  <EmptyState icon={History} title="No toggles yet" description="Flag changes will appear here" />
                ) : (
                  <div className="p-4 space-y-2">
                    {recentToggles.map((t: any) => (
                      <div key={t.id} className="flex items-start gap-3 p-2 bg-muted/30 rounded">
                        <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                          t.action === 'feature_create' ? 'bg-blue-500' : 'bg-amber-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{t.description}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span>{t.adminName || t.adminEmail || 'Unknown'}</span>
                            <span>·</span>
                            <span>{formatRelativeTime(t.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ContentCard>

              {/* Info card */}
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  💡 Feature flags take effect immediately for all users. Use them for:
                  emergency kill switches, gradual rollouts, A/B testing, and beta features.
                  Every toggle is logged in the audit trail.
                </p>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ LIST TAB ============ */}
      {tab === 'list' && (
        <>
          {/* Create new flag */}
          {showCreate && (
            <ContentCard title="Create New Feature Flag">
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    placeholder="Key (e.g., 'new_dashboard')"
                    value={newFlag.key}
                    onChange={e => setNewFlag({ ...newFlag, key: e.target.value })}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <input
                    placeholder="Label (e.g., 'New Dashboard')"
                    value={newFlag.label}
                    onChange={e => setNewFlag({ ...newFlag, label: e.target.value })}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <input
                    placeholder="Description"
                    value={newFlag.description}
                    onChange={e => setNewFlag({ ...newFlag, description: e.target.value })}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => createMutation.mutate(newFlag)}
                    disabled={!newFlag.key || !newFlag.label || createMutation.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
                  >
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Flag
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </ContentCard>
          )}

          {/* Search */}
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search flags by key or label..."
          />

          {/* Flags list */}
          <ContentCard title={`Feature Flags — ${filtered.length} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={6} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Flag}
                title="No feature flags found"
                description={search ? "Try a different search" : "Create one to get started"}
              />
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((flag: any) => (
                  <div key={flag.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{flag.key}</code>
                        <Badge variant={flag.enabled ? 'success' : 'danger'}>
                          {flag.enabled ? 'ENABLED' : 'DISABLED'}
                        </Badge>
                        {flag.toggleCount > 0 && (
                          <Badge variant="neutral">
                            <History className="w-3 h-3 inline mr-0.5" />
                            {flag.toggleCount} toggles
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium mt-1">{flag.label}</p>
                      {flag.description && <p className="text-xs text-muted-foreground mt-0.5">{flag.description}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        Updated {formatRelativeTime(flag.updatedAt)}
                        {flag.updatedBy && ` by ${flag.updatedBy}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <span className={`text-xs font-medium ${flag.enabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {flag.enabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        onClick={() => toggleMutation.mutate({ key: flag.key, enabled: !flag.enabled })}
                        disabled={toggleMutation.isPending}
                        className={`relative w-14 h-7 rounded-full transition border-2 ${
                          flag.enabled
                            ? 'bg-emerald-500 border-emerald-600'
                            : 'bg-gray-300 border-gray-400 dark:bg-gray-700 dark:border-gray-600'
                        } ${toggleMutation.isPending ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:opacity-80'}`}
                        title={flag.enabled ? 'Click to DISABLE' : 'Click to ENABLE'}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${
                          flag.enabled ? 'translate-x-7' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ContentCard>
        </>
      )}
    </div>
  )
}
