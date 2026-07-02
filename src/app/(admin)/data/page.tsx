'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Loader2, RefreshCw, TrendingUp, Wallet, Shield, AlertCircle,
  Trophy, Sparkles, ArrowRight, Database,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Pagination, Badge,
} from '@/components/admin/ui'
import { formatNumber, formatINR, formatRelativeTime } from '@/lib/utils'

// =====================================================================
// CREDIT BAND CONFIG (color + label + ₹ potential per lead)
// =====================================================================
const BANDS = {
  excellent: {
    label: 'Excellent',
    color: 'text-emerald-700 dark:text-emerald-400',
    badge: 'success' as const,
    payout: 200, // ₹ per lead
    barColor: 'bg-emerald-500',
  },
  good: {
    label: 'Good',
    color: 'text-blue-700 dark:text-blue-400',
    badge: 'info' as const,
    payout: 150,
    barColor: 'bg-blue-500',
  },
  fair: {
    label: 'Fair',
    color: 'text-amber-700 dark:text-amber-400',
    badge: 'warning' as const,
    payout: 100,
    barColor: 'bg-amber-500',
  },
  poor: {
    label: 'Poor',
    color: 'text-red-700 dark:text-red-400',
    badge: 'danger' as const,
    payout: 0,
    barColor: 'bg-red-500',
  },
}

const PAGE_SIZE = 20

export default function DataMonetizationPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [bandFilter, setBandFilter] = useState<'all' | 'excellent' | 'good' | 'fair' | 'poor'>('all')

  // ============ SUMMARY (from cache or live bulk) ============
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['admin-credit-summary'],
    queryFn: async () => {
      const r = await fetch('/api/admin/data-monetization')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  // ============ CANDIDATES (paginated, from cache) ============
  const { data: candidatesData, isLoading: candidatesLoading } = useQuery({
    queryKey: ['admin-lending-candidates', page, bandFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (bandFilter !== 'all') params.set('band', bandFilter)
      const r = await fetch(`/api/admin/data-monetization/candidates?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ COMPUTE MUTATION (triggers background job) ============
  const computeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/data-monetization/compute', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `✓ Computed ${formatNumber(data.totalScored)} scores in ${(data.durationMs / 1000).toFixed(1)}s`,
        {
          description: `Excellent: ${data.byBand.excellent} · Good: ${data.byBand.good} · Fair: ${data.byBand.fair} · Poor: ${data.byBand.poor}`,
        }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-credit-summary'] })
      queryClient.invalidateQueries({ queryKey: ['admin-lending-candidates'] })
    },
    onError: (err: Error) => {
      toast.error('Compute failed', { description: err.message })
    },
  })

  // ============ COOLDOWN POLL (so admin sees countdown) ============
  const { data: cooldownData } = useQuery({
    queryKey: ['admin-credit-compute-cooldown'],
    queryFn: async () => {
      const r = await fetch('/api/admin/data-monetization/compute')
      if (!r.ok) return { canCompute: true, cooldownRemainingSeconds: 0 }
      return r.json()
    },
    refetchInterval: computeMutation.isPending ? 1000 : false,
    staleTime: 10 * 1000,
  })

  // ============ DERIVED VALUES ============
  const cacheStaleAt = candidatesData?.cacheStaleAt
    ? new Date(candidatesData.cacheStaleAt)
    : null
  const cacheAgeMin = cacheStaleAt
    ? Math.round((Date.now() - cacheStaleAt.getTime()) / 60000)
    : null
  const candidates = candidatesData?.candidates || []
  const total = candidatesData?.total || 0
  const totalPages = candidatesData?.totalPages || 0
  const cacheEmpty = candidatesData?.cacheEmpty === true

  // Lending revenue potential from summary
  const summaryData = summary?.summary || {}
  const lendingRevenue = summary?.lendingRevenue || {}
  const totalLendingPotential = summary?.totalLendingRevenuePotential || 0

  return (
    <div className="p-6 space-y-6">
      {/* ============ HEADER ============ */}
      <PageHeader
        title="Data Monetization"
        description="Credit scoring + lending pipeline · pre-computed daily, investor-verifiable"
        actions={
          <button
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending || (cooldownData && !cooldownData.canCompute)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {computeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Computing...
              </>
            ) : cooldownData && !cooldownData.canCompute ? (
              <>
                <RefreshCw className="w-4 h-4" />
                Cooldown {cooldownData.cooldownRemainingSeconds}s
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Recompute Scores
              </>
            )}
          </button>
        }
      />

      {/* ============ CACHE STATUS BANNER ============ */}
      {cacheEmpty ? (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Credit score cache is empty
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Click <strong>Recompute Scores</strong> above to populate the cache.
              The summary below is computed live (5 bulk queries, not N+1) as a fallback.
            </p>
          </div>
        </div>
      ) : cacheAgeMin !== null ? (
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-xl p-3 flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Cache last updated <strong>{formatRelativeTime(cacheStaleAt!.toISOString())}</strong> ({cacheAgeMin} min ago).
            All scores below are served from <code className="text-[11px] bg-blue-100 dark:bg-blue-900/40 px-1 rounded">CreditScoreCache</code> — instant, scales to millions.
          </p>
        </div>
      ) : null}

      {/* ============ KPI CARDS ============ */}
      <KPIGrid>
        <KPICard
          label="Total Scored Users"
          value={summaryLoading ? '—' : formatNumber(summaryData.totalScored || 0)}
          icon={Trophy}
          iconColor="text-violet-600"
          sublabel="Users with ≥1 transaction in 6 months"
        />
        <KPICard
          label="Average Score"
          value={summaryLoading ? '—' : String(summaryData.avgScore || 0)}
          icon={TrendingUp}
          iconColor="text-blue-600"
          sublabel="Scale: 300 (poor) → 900 (excellent)"
        />
        <KPICard
          label="Lending Revenue Potential"
          value={summaryLoading ? '—' : formatINR(totalLendingPotential)}
          icon={Wallet}
          iconColor="text-emerald-600"
          sublabel="Per-lead: ₹200/₹150/₹100 by band"
        />
        <KPICard
          label="Excellent Band Users"
          value={summaryLoading ? '—' : formatNumber(summaryData.excellent || 0)}
          icon={Shield}
          iconColor="text-emerald-600"
          sublabel="Prime lending candidates (≥750 score)"
        />
      </KPIGrid>

      {/* ============ BAND DISTRIBUTION ============ */}
      <ContentCard title="Score Distribution by Band">
        {summaryLoading ? (
          <LoadingSkeleton rows={4} />
        ) : summaryData.totalScored > 0 ? (
          <div className="space-y-3">
            {(['excellent', 'good', 'fair', 'poor'] as const).map((band) => {
              const count = summaryData[band] || 0
              const pct = summaryData.totalScored > 0
                ? Math.round((count / summaryData.totalScored) * 100)
                : 0
              const cfg = BANDS[band]
              return (
                <div key={band} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-muted-foreground">
                        Score {band === 'excellent' ? '750+' : band === 'good' ? '650-749' : band === 'fair' ? '550-649' : '<550'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        ₹{cfg.payout}/lead
                      </span>
                      <span className="font-semibold">{formatNumber(count)}</span>
                      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${cfg.barColor} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={AlertCircle}
            title="No scored users yet"
            description="Click 'Recompute Scores' to populate the cache"
          />
        )}
      </ContentCard>

      {/* ============ LENDING REVENUE BREAKDOWN ============ */}
      {!summaryLoading && summaryData.totalScored > 0 && (
        <ContentCard title="Lending Revenue Breakdown">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-2">Band</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">Users</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">Per Lead</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(['excellent', 'good', 'fair'] as const).map((band) => {
                const cfg = BANDS[band]
                const r = lendingRevenue[band] || { count: 0, totalPotential: 0 }
                return (
                  <tr key={band} className="hover:bg-muted/30">
                    <td className="px-4 py-2"><Badge variant={cfg.badge}>{cfg.label}</Badge></td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.count)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(cfg.payout)}</td>
                    <td className="px-4 py-2 text-right font-bold">{formatINR(r.totalPotential)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-muted/30 border-t-2 border-border">
              <tr>
                <td className="px-4 py-2 font-bold" colSpan={3}>Total Revenue Potential</td>
                <td className="px-4 py-2 text-right font-bold text-violet-600">{formatINR(totalLendingPotential)}</td>
              </tr>
            </tfoot>
          </table>
        </ContentCard>
      )}

      {/* ============ TOP LENDING CANDIDATES (paginated) ============ */}
      <ContentCard
        title="Top Lending Candidates"
        action={
          <div className="flex items-center gap-2">
            {/* Band filter pills */}
            {(['all', 'excellent', 'good', 'fair', 'poor'] as const).map((b) => (
              <button
                key={b}
                onClick={() => { setBandFilter(b); setPage(1) }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  bandFilter === b
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {b === 'all' ? 'All' : BANDS[b].label}
              </button>
            ))}
          </div>
        }
      >
        {candidatesLoading ? (
          <LoadingSkeleton rows={8} />
        ) : candidates.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={cacheEmpty ? 'Cache is empty' : 'No candidates in this band'}
            description={cacheEmpty
              ? 'Click "Recompute Scores" above to populate'
              : 'Try a different band filter'}
          />
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">User</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Score</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Band</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Monthly Sales</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Collection %</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Business Age</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {candidates.map((c: any, idx: number) => {
                const cfg = BANDS[c.band as keyof typeof BANDS] || BANDS.poor
                const rank = (page - 1) * PAGE_SIZE + idx + 1
                return (
                  <tr key={c.userId} className="hover:bg-muted/30 transition">
                    <td className="px-4 py-3">
                      <Link href={`/users/${c.userId}`} className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                          #{rank}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{c.userId.slice(0, 12)}…</p>
                          <p className="text-[11px] text-muted-foreground">
                            {c.productCount} products · {c.partyCount} parties
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-lg font-bold ${cfg.color}`}>{c.score}</span>
                      <span className="text-[10px] text-muted-foreground ml-1">/900</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={cfg.badge}>{cfg.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">
                      {formatINR(Math.round(c.avgMonthlySales))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      <span className={c.collectionRate >= 0.85 ? 'text-emerald-600 font-medium' : c.collectionRate >= 0.7 ? 'text-amber-600' : 'text-red-600'}>
                        {Math.round(c.collectionRate * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {c.businessAgeDays > 365
                        ? `${Math.floor(c.businessAgeDays / 365)}y ${Math.floor((c.businessAgeDays % 365) / 30)}m`
                        : c.businessAgeDays > 30
                        ? `${Math.floor(c.businessAgeDays / 30)}m`
                        : `${c.businessAgeDays}d`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/users/${c.userId}`}
                        className="inline-flex items-center text-xs text-primary hover:underline"
                      >
                        View <ArrowRight className="w-3 h-3 ml-0.5" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </ContentCard>

      {/* ============ PAGINATION ============ */}
      {total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      {/* ============ HOW IT WORKS (transparency card) ============ */}
      <div className="bg-muted/30 rounded-xl border border-border p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          How scores are computed (investor-readable)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-1">5-Factor Model (300-900 scale, CIBIL-style):</p>
            <ul className="space-y-0.5">
              <li>• Transaction volume (200 pts) — avg monthly sales, 6 months</li>
              <li>• Collection rate (150 pts) — paid / total sales</li>
              <li>• Product diversity (100 pts) — distinct products</li>
              <li>• Party base (75 pts) — distinct customers/suppliers</li>
              <li>• Transaction consistency (175 pts) — total count</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">Performance (scales to millions):</p>
            <ul className="space-y-0.5">
              <li>• <strong>5 bulk groupBy queries</strong> (not 4×N) at compute time</li>
              <li>• Scores cached in <code className="text-[11px] bg-muted px-1 rounded">CreditScoreCache</code></li>
              <li>• Page reads <strong>only from cache</strong> = instant load</li>
              <li>• Background job runs daily via cron</li>
              <li>• Cooldown: 5 min between manual recomputes</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ============ COMPLIANCE WARNING ============ */}
      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              DPDP Act 2025 Compliance Required
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Before sharing any user data with NBFCs or FMCG companies: get explicit consent,
              allow revocation, share only anonymized data where possible, maintain audit trail,
              report breaches within 72 hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
