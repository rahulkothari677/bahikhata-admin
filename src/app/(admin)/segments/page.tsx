'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { PageHeader, KPIGrid, KPICard, EmptyState, LoadingSkeleton } from '@/components/admin/ui'
import { formatNumber } from '@/lib/utils'

const SEGMENT_COLORS: Record<string, string> = {
  emerald: 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20',
  blue: 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20',
  amber: 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20',
  red: 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20',
  violet: 'border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/20',
  orange: 'border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/20',
  slate: 'border-slate-200 dark:border-slate-900 bg-slate-50 dark:bg-slate-950/20',
}

const SEGMENT_TEXT: Record<string, string> = {
  emerald: 'text-emerald-700 dark:text-emerald-400',
  blue: 'text-blue-700 dark:text-blue-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-red-700 dark:text-red-400',
  violet: 'text-violet-700 dark:text-violet-400',
  orange: 'text-orange-700 dark:text-orange-400',
  slate: 'text-slate-700 dark:text-slate-400',
}

export default function SegmentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-segments-v2'],
    queryFn: async () => {
      const r = await fetch('/api/admin/segments')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 min cache
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="User Segments" description="Auto-categorized based on behavior" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-1/3 mb-3" />
              <div className="h-8 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!data?.success) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="User Segments" description="Auto-categorized based on behavior" />
        <EmptyState icon={Loader2} title="Failed to load segments" description="Please try refreshing" />
      </div>
    )
  }

  const { segments, totalUsers } = data

  // Top 4 segments as KPI cards
  const topSegments = segments.slice(0, 4)

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="User Segments"
        description={`${formatNumber(totalUsers)} total users across ${segments.length} segments`}
      />

      {/* Top 4 segments as KPI cards */}
      <KPIGrid>
        {topSegments.map((seg: any) => {
          const pct = totalUsers > 0 ? Math.round((seg.count / totalUsers) * 100) : 0
          return (
            <Link
              key={seg.id}
              href={`/segments/${seg.id}`}
              className={`rounded-xl border p-4 hover:shadow-md transition cursor-pointer ${SEGMENT_COLORS[seg.color] || 'bg-muted'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">{seg.icon}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold">{formatNumber(seg.count)}</p>
              <p className={`text-xs font-medium ${SEGMENT_TEXT[seg.color] || ''}`}>{seg.name}</p>
              <p className="text-[10px] text-muted-foreground">{pct}% of users</p>
            </Link>
          )
        })}
      </KPIGrid>

      {/* All segments — grid of cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {segments.slice(4).map((seg: any) => {
          const pct = totalUsers > 0 ? Math.round((seg.count / totalUsers) * 100) : 0
          return (
            <Link
              key={seg.id}
              href={`/segments/${seg.id}`}
              className={`rounded-xl border p-3 hover:shadow-md transition cursor-pointer ${SEGMENT_COLORS[seg.color] || 'bg-muted'}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{seg.icon}</span>
                  <div>
                    <p className={`text-sm font-bold ${SEGMENT_TEXT[seg.color] || ''}`}>{seg.name}</p>
                    <p className="text-xs text-muted-foreground">{seg.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{formatNumber(seg.count)}</p>
                  <p className="text-[10px] text-muted-foreground">{pct}%</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 Segments use bulk aggregate queries (count + groupBy), NOT per-user queries.
          This scales to millions of users with the same 10 queries. Click any segment to
          view its users with search and pagination.
        </p>
      </div>
    </div>
  )
}
