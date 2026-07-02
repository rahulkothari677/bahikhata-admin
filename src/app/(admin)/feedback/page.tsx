'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  MessageSquare, Star, TrendingUp, Users, Zap, AlertCircle,
  ChevronLeft, ChevronRight, ThumbsUp, Meh, ThumbsDown,
} from 'lucide-react'
import Link from 'next/link'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

const SCORE_COLORS: Record<number, string> = {
  10: 'bg-emerald-500 text-white',
  9: 'bg-emerald-500 text-white',
  8: 'bg-amber-500 text-white',
  7: 'bg-amber-500 text-white',
  6: 'bg-red-500 text-white',
  5: 'bg-red-500 text-white',
  4: 'bg-red-500 text-white',
  3: 'bg-red-500 text-white',
  2: 'bg-red-500 text-white',
  1: 'bg-red-500 text-white',
  0: 'bg-red-500 text-white',
}

const CATEGORY_BADGE: Record<string, 'success' | 'warning' | 'danger'> = {
  promoter: 'success',
  passive: 'warning',
  detractor: 'danger',
}

const CATEGORY_ICON: Record<string, any> = {
  promoter: ThumbsUp,
  passive: Meh,
  detractor: ThumbsDown,
}

export default function FeedbackPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'promoter' | 'passive' | 'detractor'>('all')

  // ============ OVERVIEW DATA ============
  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-nps-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/nps?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-nps-list', page, search, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        page: String(page),
        category: categoryFilter,
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/nps?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ DERIVED ============
  const summary = overviewData?.summary || {}
  const scoreDist = overviewData?.scoreDistribution || []
  const feedback = listData?.feedback || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  // NPS score color
  const npsColor = (summary.npsScore || 0) >= 50
    ? 'text-emerald-600'
    : (summary.npsScore || 0) >= 0
    ? 'text-amber-600'
    : 'text-red-600'
  const npsBg = (summary.npsScore || 0) >= 50
    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
    : (summary.npsScore || 0) >= 0
    ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
    : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
  const npsLabel = (summary.npsScore || 0) >= 50
    ? 'Excellent — world-class'
    : (summary.npsScore || 0) >= 0
    ? 'Good — room to improve'
    : 'Needs attention'

  // Max count for score distribution bars
  const maxScoreCount = scoreDist.length > 0
    ? Math.max(...scoreDist.map((s: any) => s.count))
    : 1

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="User Feedback (NPS)"
        description="Net Promoter Score and user satisfaction · bulk aggregate + paginated"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Feedback', icon: MessageSquare },
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
            <EmptyState
              icon={AlertCircle}
              title="Failed to load feedback data"
              description="Please try refreshing the page"
            />
          ) : (
            <>
              {/* NPS Score banner */}
              <div className={`rounded-xl border p-4 ${npsBg}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide opacity-70">NPS Score</p>
                    <p className={`text-4xl font-bold mt-1 ${npsColor}`}>
                      {(summary.npsScore || 0) > 0 ? '+' : ''}{summary.npsScore || 0}
                    </p>
                    <p className="text-xs opacity-70 mt-1">{npsLabel}</p>
                  </div>
                  <Star className="w-12 h-12 opacity-80" />
                </div>
              </div>

              {/* 4 KPI cards */}
              <KPIGrid>
                <KPICard
                  label="Total Responses"
                  value={formatNumber(summary.total || 0)}
                  icon={Users}
                  iconColor="text-blue-600"
                  sublabel={`${summary.newFeedback7d || 0} new in last 7 days`}
                />
                <KPICard
                  label="Average Score"
                  value={`${summary.avgScore || 0}/10`}
                  icon={Star}
                  iconColor="text-violet-600"
                  sublabel="Across all responses"
                />
                <KPICard
                  label="Promoters (9-10)"
                  value={formatNumber(summary.promoters || 0)}
                  icon={ThumbsUp}
                  iconColor="text-emerald-600"
                  sublabel={`${summary.total > 0 ? Math.round(((summary.promoters || 0) / summary.total) * 100) : 0}% of total`}
                />
                <KPICard
                  label="Detractors (0-6)"
                  value={formatNumber(summary.detractors || 0)}
                  icon={ThumbsDown}
                  iconColor="text-red-600"
                  sublabel={`${summary.total > 0 ? Math.round(((summary.detractors || 0) / summary.total) * 100) : 0}% of total`}
                />
              </KPIGrid>

              {/* Score distribution */}
              <ContentCard title="Score Distribution (0-10 scale)">
                {scoreDist.length === 0 ? (
                  <EmptyState
                    icon={Star}
                    title="No feedback yet"
                    description="Add an NPS survey to the main app to start collecting"
                  />
                ) : (
                  <div className="p-4 space-y-2">
                    {/* Render all 11 scores (0-10), even if 0 responses */}
                    {Array.from({ length: 11 }, (_, score) => {
                      const found = scoreDist.find((s: any) => s.score === score)
                      const count = found?.count || 0
                      const pct = maxScoreCount > 0 ? Math.round((count / maxScoreCount) * 100) : 0
                      return (
                        <div key={score} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${SCORE_COLORS[score] || 'bg-muted'}`}>
                                {score}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {score >= 9 ? 'Promoter' : score >= 7 ? 'Passive' : 'Detractor'}
                              </span>
                            </div>
                            <span className="text-xs font-medium">{count} responses</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                score >= 9 ? 'bg-emerald-500' :
                                score >= 7 ? 'bg-amber-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </ContentCard>

              {/* NPS explainer */}
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  💡 NPS = % Promoters (9-10) − % Detractors (0-6). Score range: -100 to +100.
                  50+ = Excellent, 0-49 = Good, below 0 = Needs improvement.
                  To collect feedback, add an NPS survey widget to the main app.
                </p>
              </div>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How data is computed (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Bulk Aggregate Queries:</p>
                    <ul className="space-y-0.5">
                      <li>• 5 parallel <code className="text-[11px] bg-muted px-1 rounded">count()</code> + <code className="text-[11px] bg-muted px-1 rounded">aggregate()</code> for KPIs</li>
                      <li>• Promoter/passive/detractor counts via <code className="text-[11px] bg-muted px-1 rounded">count()</code> — DB-side</li>
                      <li>• Score distribution via <code className="text-[11px] bg-muted px-1 rounded">groupBy(score)</code> — DB-side</li>
                      <li>• NPS computed from DB-side counts (not JS-side filter)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Performance & Scale:</p>
                    <ul className="space-y-0.5">
                      <li>• Overview tab: ~50ms (6 parallel aggregate queries)</li>
                      <li>• List tab: ~100ms (findMany with take=20 + count)</li>
                      <li>• All queries: <code className="text-[11px] bg-muted px-1 rounded">withTimeout(5000ms)</code> + <code className="text-[11px] bg-muted px-1 rounded">.catch()</code></li>
                      <li>• Cached for 60s in browser (no polling)</li>
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
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1">
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setPage(1) }}
                placeholder="Search by feedback text or user email/name..."
              />
            </div>
            <div className="flex items-center gap-2">
              {(['all', 'promoter', 'passive', 'detractor'] as const).map((c) => {
                const Icon = c === 'all' ? MessageSquare : CATEGORY_ICON[c]
                return (
                  <button
                    key={c}
                    onClick={() => { setCategoryFilter(c); setPage(1) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                      categoryFilter === c
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {c === 'all' ? 'All' : c + 's'}
                  </button>
                )
              })}
            </div>
          </div>

          <ContentCard title={`All Feedback — ${total} total`}>
            {listLoading ? (
              <LoadingSkeleton rows={8} />
            ) : feedback.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No feedback found"
                description={search || categoryFilter !== 'all'
                  ? "Try adjusting your filters"
                  : "No feedback collected yet"}
              />
            ) : (
              <div className="divide-y divide-border">
                {feedback.map((f: any) => {
                  const Icon = CATEGORY_ICON[f.category] || MessageSquare
                  return (
                    <div key={f.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition">
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                        f.score >= 9 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' :
                        f.score >= 7 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' :
                        'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                      }`}>
                        {f.score}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {f.userId ? (
                            <Link
                              href={`/users/${f.userId}`}
                              className="text-sm font-medium hover:underline"
                            >
                              {f.userName || f.userEmail || 'Anonymous'}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium">
                              {f.userName || f.userEmail || 'Anonymous'}
                            </span>
                          )}
                          <Badge variant={CATEGORY_BADGE[f.category] || 'neutral'}>
                            <Icon className="w-3 h-3 inline mr-1" />
                            {f.category}
                          </Badge>
                          {f.userPlan && (
                            <Badge variant="neutral">{f.userPlan}</Badge>
                          )}
                        </div>
                        {f.feedback && (
                          <p className="text-sm text-muted-foreground mt-1 italic">
                            &ldquo;{f.feedback}&rdquo;
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatRelativeTime(f.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
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
