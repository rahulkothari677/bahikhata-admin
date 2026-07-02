'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ScrollText, ChevronDown, ChevronRight, Search, TrendingUp,
  Activity, Clock, AlertCircle,
} from 'lucide-react'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

export default function AuditLogPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [targetTypeFilter, setTargetTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // ============ OVERVIEW DATA ============
  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-audit-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/audit-log?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-audit-list', page, search, actionFilter, targetTypeFilter, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        action: actionFilter,
        targetType: targetTypeFilter,
      })
      if (search) params.set('search', search)
      if (dateFrom) params.set('dateFrom', new Date(dateFrom).toISOString())
      if (dateTo) params.set('dateTo', new Date(dateTo + 'T23:59:59').toISOString())
      const r = await fetch(`/api/admin/audit-log?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  const ov = overviewData?.overview || {}
  const actions = listData?.actions || []
  const actionTypes = listData?.actionTypes || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Audit Log Explorer"
        description="Every admin action permanently recorded · DPDP compliant · server-side search + filters"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Actions', icon: ScrollText },
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
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Actions Today"
                  value={formatNumber(ov.todayCount || 0)}
                  icon={Activity}
                  iconColor="text-blue-600"
                  sublabel="Last 24 hours"
                />
                <KPICard
                  label="This Week"
                  value={formatNumber(ov.weekCount || 0)}
                  icon={Clock}
                  iconColor="text-violet-600"
                  sublabel="Last 7 days"
                />
                <KPICard
                  label="This Month"
                  value={formatNumber(ov.monthCount || 0)}
                  icon={TrendingUp}
                  iconColor="text-emerald-600"
                  sublabel="Last 30 days"
                />
                <KPICard
                  label="Total (all time)"
                  value={formatNumber(ov.totalCount || 0)}
                  icon={ScrollText}
                  iconColor="text-slate-600"
                  sublabel="Permanent record"
                />
              </KPIGrid>

              {/* Top actions */}
              <ContentCard title="Top Actions (Last 30 Days)">
                {overviewData.topActions?.length === 0 ? (
                  <EmptyState icon={ScrollText} title="No actions yet" description="Admin activity will appear here" />
                ) : (
                  <div className="p-4 space-y-2">
                    {overviewData.topActions?.map((a: any, i: number) => {
                      const maxCount = Math.max(...(overviewData.topActions || []).map((x: any) => x.count), 1)
                      const pct = Math.round((a.count / maxCount) * 100)
                      return (
                        <div key={a.action} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <code className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{a.action}</code>
                            <span className="font-medium">{a.count} times</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </ContentCard>

              {/* Top target types */}
              <ContentCard title="Top Target Types (Last 30 Days)">
                {overviewData.topTargetTypes?.length === 0 ? (
                  <EmptyState icon={ScrollText} title="No data" />
                ) : (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {overviewData.topTargetTypes?.map((t: any) => (
                      <div key={t.targetType} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                        <code className="text-xs font-mono">{t.targetType}</code>
                        <Badge variant="info">{t.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ContentCard>

              {/* Compliance note */}
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  🔒 Audit logs are permanent and cannot be deleted. Required for:
                  DPDP Act compliance, security forensics, dispute resolution, investor due diligence.
                  Click any row in the "All Actions" tab to see before/after metadata.
                </p>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ LIST TAB ============ */}
      {tab === 'list' && (
        <>
          {/* Filters */}
          <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setPage(1) }}
                placeholder="Search description, admin email, or action..."
              />
            </div>
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Actions</option>
              {actionTypes.map((a: any) => (
                <option key={a.action} value={a.action}>{a.action} ({a.count})</option>
              ))}
            </select>
            <select
              value={targetTypeFilter}
              onChange={(e) => { setTargetTypeFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Targets</option>
              <option value="user">User</option>
              <option value="feature_flag">Feature Flag</option>
              <option value="subscription">Subscription</option>
              <option value="campaign">Campaign</option>
              <option value="notification_template">Notification Template</option>
              <option value="incident">Incident</option>
              <option value="partner">Partner</option>
              <option value="api_key">API Key</option>
              <option value="webhook_endpoint">Webhook Endpoint</option>
              <option value="experiment">Experiment</option>
              <option value="competitor">Competitor</option>
              <option value="fraud_rule">Fraud Rule</option>
              <option value="anomaly">Anomaly</option>
              <option value="database">Database</option>
              <option value="null">No Target</option>
            </select>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">Date range:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
                className="text-xs text-primary hover:underline"
              >
                Clear dates
              </button>
            )}
          </div>

          {/* Results */}
          <ContentCard title={`Audit Actions — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={10} />
            ) : actions.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title="No actions found"
                description={search || actionFilter !== 'all' || targetTypeFilter !== 'all' || dateFrom || dateTo
                  ? "Try adjusting your filters"
                  : "No admin actions recorded yet"}
              />
            ) : (
              <div className="divide-y divide-border">
                {actions.map((a: any) => (
                  <div key={a.id}>
                    <button
                      onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                      className="w-full text-left p-4 hover:bg-muted/30 transition"
                    >
                      <div className="flex items-start gap-3">
                        {a.metadata ? (
                          expanded === a.id ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                          )
                        ) : (
                          <div className="w-4 h-4 mt-1 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{a.action}</code>
                            {a.targetType && <Badge variant="neutral">{a.targetType}</Badge>}
                          </div>
                          <p className="text-sm">{a.description}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{a.adminName || a.adminEmail || 'Unknown admin'}</span>
                            <span>·</span>
                            <span>{formatRelativeTime(a.createdAt)}</span>
                            {a.ip && (<><span>·</span><span className="font-mono">{a.ip}</span></>)}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded metadata */}
                    {expanded === a.id && a.metadata && (
                      <div className="bg-muted/20 p-4 border-t border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Metadata</p>
                        <pre className="text-xs font-mono bg-background border border-border rounded p-3 overflow-x-auto">
                          {JSON.stringify(a.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
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
    </div>
  )
}
