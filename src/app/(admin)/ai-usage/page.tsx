'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Coins, Zap, TrendingUp, Clock, Search, AlertCircle,
  ChevronLeft, ChevronRight, Cpu, Users,
} from 'lucide-react'
import Link from 'next/link'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'top-users' | 'recent'

const PAGE_SIZE = 20

const PROVIDER_COLORS: Record<string, string> = {
  gemini: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  groq: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  openai: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  vlm: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
}

export default function AIUsagePage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [featureFilter, setFeatureFilter] = useState<'all' | 'scan-bill' | 'voice-parse'>('all')
  const [providerFilter, setProviderFilter] = useState<'all' | 'gemini' | 'groq' | 'openai' | 'vlm'>('all')

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-ai-usage-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/ai-usage?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000, // 1 min cache (NOT 30s polling)
  })

  // ============ TOP USERS DATA ============
  const { data: topUsersData, isLoading: topUsersLoading } = useQuery({
    queryKey: ['admin-ai-usage-top-users', page, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'top-users',
        page: String(page),
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/ai-usage?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'top-users',
    staleTime: 60 * 1000,
  })

  // ============ RECENT CALLS DATA ============
  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ['admin-ai-usage-recent', page, search, featureFilter, providerFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'recent',
        page: String(page),
        feature: featureFilter,
        provider: providerFilter,
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/ai-usage?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'recent',
    staleTime: 30 * 1000,
  })

  // ============ DERIVED ============
  const periods = overview?.periods || {}
  const featureBreakdown = overview?.featureBreakdown || {}
  const providerBreakdown = overview?.providerBreakdown || {}

  return (
    <div className="p-6 space-y-6">
      {/* ============ HEADER ============ */}
      <PageHeader
        title="AI Usage & Cost"
        description="Real-time AI cost tracking · bulk aggregate queries, scales to millions of calls"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'top-users' as const, label: 'Top Users', icon: Users },
          { id: 'recent' as const, label: 'Recent Calls', icon: Clock },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setPage(1) }}
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
            <EmptyState
              icon={AlertCircle}
              title="Failed to load AI usage data"
              description="Please try refreshing the page"
            />
          ) : (
            <>
              {/* 4 KPI cards */}
              <KPIGrid>
                <KPICard
                  label="Today's Cost"
                  value={formatINR(periods.today?.costInr || 0)}
                  icon={Zap}
                  iconColor="text-amber-600"
                  sublabel={`${formatNumber(periods.today?.calls || 0)} calls · ${formatNumber(periods.today?.totalTokens || 0)} tokens`}
                />
                <KPICard
                  label="This Week"
                  value={formatINR(periods.week?.costInr || 0)}
                  icon={TrendingUp}
                  iconColor="text-blue-600"
                  sublabel={`${formatNumber(periods.week?.calls || 0)} calls`}
                />
                <KPICard
                  label="This Month"
                  value={formatINR(periods.month?.costInr || 0)}
                  icon={Coins}
                  iconColor="text-orange-600"
                  sublabel={`${formatNumber(periods.month?.calls || 0)} calls · ${periods.month?.failCount || 0} failed`}
                />
                <KPICard
                  label="All Time"
                  value={formatINR(periods.allTime?.costInr || 0)}
                  icon={Clock}
                  iconColor="text-violet-600"
                  sublabel={`${formatNumber(periods.allTime?.calls || 0)} total calls`}
                />
              </KPIGrid>

              {/* Feature + Provider breakdown side-by-side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ContentCard title="By Feature (This Month)">
                  <div className="p-4 space-y-3">
                    {Object.entries(featureBreakdown).map(([feature, stats]: any) => {
                      const total = periods.month?.costInr || 1
                      const pct = total > 0 ? Math.round((stats.costInr / total) * 100) : 0
                      return (
                        <div key={feature} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium capitalize">{feature.replace('-', ' ')}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground">{stats.calls} calls</span>
                              <span className="font-bold text-amber-700 dark:text-amber-400">{formatINR(stats.costInr)}</span>
                              <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                            </div>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {formatNumber(stats.totalTokens)} tokens
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </ContentCard>

                <ContentCard title="By Provider (This Month)">
                  <div className="p-4 space-y-3">
                    {Object.entries(providerBreakdown)
                      .filter(([, s]: any) => s.calls > 0)
                      .map(([provider, stats]: any) => {
                        const total = periods.month?.costInr || 1
                        const pct = total > 0 ? Math.round((stats.costInr / total) * 100) : 0
                        const colorClass = PROVIDER_COLORS[provider] || 'bg-muted text-muted-foreground'
                        return (
                          <div key={provider} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${colorClass}`}>
                                  {provider}
                                </span>
                                <span className="text-xs text-muted-foreground">{stats.calls} calls</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-bold text-amber-700 dark:text-amber-400">{formatINR(stats.costInr)}</span>
                                <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                              </div>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    {Object.keys(providerBreakdown).filter(k => providerBreakdown[k].calls > 0).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No provider calls this month</p>
                    )}
                  </div>
                </ContentCard>
              </div>

              {/* Today's success rate */}
              <ContentCard title="Today's Performance">
                <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Calls</p>
                    <p className="text-xl font-bold">{formatNumber(periods.today?.calls || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Success Rate</p>
                    <p className="text-xl font-bold text-emerald-600">
                      {periods.today?.calls > 0
                        ? Math.round(((periods.today?.successCount || 0) / periods.today.calls) * 100)
                        : 0}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Failed</p>
                    <p className="text-xl font-bold text-red-600">{periods.today?.failCount || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Avg Duration</p>
                    <p className="text-xl font-bold">{periods.today?.avgDurationMs || 0}ms</p>
                  </div>
                </div>
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How data is computed (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Bulk Aggregate Queries:</p>
                    <ul className="space-y-0.5">
                      <li>• 4 parallel <code className="text-[11px] bg-muted px-1 rounded">aggregate()</code> for today/week/month/all-time</li>
                      <li>• 2 parallel <code className="text-[11px] bg-muted px-1 rounded">groupBy()</code> for feature + provider breakdowns</li>
                      <li>• 4 parallel <code className="text-[11px] bg-muted px-1 rounded">count()</code> for success/fail split</li>
                      <li>• <strong>Total: 10 queries</strong>, O(1) regardless of row count</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Performance & Scale:</p>
                    <ul className="space-y-0.5">
                      <li>• No <code className="text-[11px] bg-muted px-1 rounded">findMany()</code> on full tables — uses <code className="text-[11px] bg-muted px-1 rounded">aggregate</code> only</li>
                      <li>• All queries wrapped in <code className="text-[11px] bg-muted px-1 rounded">withTimeout(5000ms)</code></li>
                      <li>• Errors caught → safe defaults (never crash)</li>
                      <li>• Cached for 1 min in browser (no polling)</li>
                      <li>• Top Users + Recent Calls paginated server-side (no unbounded fetch)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ TOP USERS TAB ============ */}
      {tab === 'top-users' && (
        <>
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setPage(1) }}
            placeholder="Search by user name or email..."
          />

          <ContentCard title={`Top Users by AI Cost (This Month) — ${topUsersData?.total || 0} users`}>
            {topUsersLoading ? (
              <LoadingSkeleton rows={8} />
            ) : (topUsersData?.topUsers || []).length === 0 ? (
              <EmptyState
                icon={Users}
                title="No users found"
                description={search ? "Try adjusting your search" : "No AI calls this month yet"}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Rank</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">User</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Plan</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Calls</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Tokens</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Cost (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(topUsersData?.topUsers || []).map((u: any, i: number) => {
                    const rank = (page - 1) * PAGE_SIZE + i + 1
                    return (
                      <tr key={u.userId} className="hover:bg-muted/30 transition">
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-muted-foreground">#{rank}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/users/${u.userId}`} className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                              {(u.user?.name || u.user?.email || '?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{u.user?.name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{u.user?.email}</p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={u.user?.plan === 'elite' ? 'info' : u.user?.plan === 'pro' ? 'warning' : 'neutral'}>
                            {u.user?.plan || 'free'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums">{formatNumber(u.calls)}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums">{formatNumber(u.totalTokens)}</td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-amber-700 dark:text-amber-400">
                          {formatINR(u.costInr)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </ContentCard>

          {(topUsersData?.total || 0) > 0 && (
            <Pagination
              page={page}
              totalPages={topUsersData?.totalPages || 0}
              total={topUsersData?.total || 0}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* ============ RECENT CALLS TAB ============ */}
      {tab === 'recent' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1">
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setPage(1) }}
                placeholder="Search by user email..."
              />
            </div>
            <div className="flex items-center gap-2">
              {/* Feature filter */}
              {(['all', 'scan-bill', 'voice-parse'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setFeatureFilter(f); setPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                    featureFilter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {f === 'all' ? 'All Features' : f.replace('-', ' ')}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {/* Provider filter */}
              {(['all', 'gemini', 'groq', 'openai', 'vlm'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => { setProviderFilter(p); setPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                    providerFilter === p
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <ContentCard title={`Recent AI Calls — ${recentData?.total || 0} total`}>
            {recentLoading ? (
              <LoadingSkeleton rows={10} />
            ) : (recentData?.recentCalls || []).length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No calls found"
                description={search || featureFilter !== 'all' || providerFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "No AI calls have been made yet"}
              />
            ) : (
              <div className="divide-y divide-border">
                {(recentData?.recentCalls || []).map((call: any) => (
                  <div
                    key={call.id}
                    className={`flex items-center gap-3 p-3 transition ${call.success ? 'hover:bg-muted/30' : 'bg-red-50/50 dark:bg-red-950/20'}`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${call.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium capitalize">{call.feature.replace('-', ' ')}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${PROVIDER_COLORS[call.provider] || 'bg-muted text-muted-foreground'}`}>
                          {call.provider}
                        </span>
                        <span className="text-xs text-muted-foreground">{call.model}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate">{call.userEmail || 'unknown'}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{formatRelativeTime(call.createdAt)}</span>
                      </div>
                      {!call.success && call.errorMessage && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate">
                          ⚠ {call.errorMessage}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-mono">{formatNumber(call.totalTokens)} tok</p>
                      <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{formatINR(call.costInr)}</p>
                    </div>
                    <div className="text-right flex-shrink-0 text-xs text-muted-foreground">
                      <p>{call.durationMs}ms</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ContentCard>

          {(recentData?.total || 0) > 0 && (
            <Pagination
              page={page}
              totalPages={recentData?.totalPages || 0}
              total={recentData?.total || 0}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}
