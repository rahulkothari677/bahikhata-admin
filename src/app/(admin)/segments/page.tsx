'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2, ChevronRight } from 'lucide-react'
import Link from 'next/link'

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
    queryKey: ['admin-segments'],
    queryFn: async () => {
      const r = await fetch('/api/admin/segments')
      return r.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.success) return <div className="p-6 text-muted-foreground">Failed to load segments</div>

  const { segments, totalUsers } = data

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Segments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {totalUsers} total users across {segments.length} segments. Click a segment to view users.
        </p>
      </div>

      {/* Grid of segment cards — NO inline user lists, just counts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {segments.map((seg: any) => {
          const pct = totalUsers > 0 ? Math.round((seg.count / totalUsers) * 100) : 0
          return (
            <Link
              key={seg.id}
              href={`/segments/${seg.id}`}
              className={`rounded-xl border p-4 hover:shadow-md transition cursor-pointer ${SEGMENT_COLORS[seg.color] || 'bg-muted'}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{seg.icon}</span>
                  <div>
                    <p className={`text-sm font-bold ${SEGMENT_TEXT[seg.color] || ''}`}>{seg.name}</p>
                    <p className="text-xs text-muted-foreground">{seg.description}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="text-2xl font-bold">{seg.count}</p>
                  <p className="text-[10px] text-muted-foreground">{pct}% of users</p>
                </div>
                {/* Mini progress bar */}
                <div className="w-20 h-2 bg-black/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: 'currentColor',
                      opacity: 0.6,
                    }}
                  />
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 Click any segment to view all users in that segment with search and pagination.
          Segments auto-update in real-time based on user behavior.
        </p>
      </div>
    </div>
  )
}
