'use client'

import { useQuery } from '@tanstack/react-query'
import { Users, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { formatNumber } from '@/lib/utils'
import Link from 'next/link'

const SEGMENT_COLORS: Record<string, string> = {
  emerald: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400',
  blue: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400',
  amber: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400',
  red: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-700 dark:text-red-400',
  violet: 'bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900 text-violet-700 dark:text-violet-400',
  orange: 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900 text-orange-700 dark:text-orange-400',
  slate: 'bg-slate-50 dark:bg-slate-950/20 border-slate-200 dark:border-slate-900 text-slate-700 dark:text-slate-400',
}

export default function SegmentsPage() {
  const [expanded, setExpanded] = useState<string | null>(null)

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
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600" />
          User Segments
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-categorized segments based on behavior, engagement, and plan. Click to expand.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {segments.slice(0, 5).map((seg: any) => (
          <div key={seg.id} className={`rounded-lg border p-3 ${SEGMENT_COLORS[seg.color] || 'bg-muted'}`}>
            <p className="text-2xl mb-1">{seg.icon}</p>
            <p className="text-xl font-bold">{seg.count}</p>
            <p className="text-[10px] uppercase tracking-wide opacity-70">{seg.name}</p>
          </div>
        ))}
      </div>

      {/* Detailed segments */}
      <div className="space-y-2">
        {segments.map((seg: any) => (
          <div key={seg.id} className="bg-card rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === seg.id ? null : seg.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition"
            >
              <div className="flex items-center gap-3">
                {expanded === seg.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className="text-xl">{seg.icon}</span>
                <div className="text-left">
                  <p className="text-sm font-medium">{seg.name}</p>
                  <p className="text-xs text-muted-foreground">{seg.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEGMENT_COLORS[seg.color] || 'bg-muted'}`}>
                  {seg.count} {seg.count === 1 ? 'user' : 'users'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {totalUsers > 0 ? `${Math.round((seg.count / totalUsers) * 100)}%` : '—'}
                </span>
              </div>
            </button>
            {expanded === seg.id && (
              <div className="border-t border-border p-3 space-y-1">
                {seg.users.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No users in this segment</p>
                ) : (
                  seg.users.map((u: any) => (
                    <Link
                      key={u.id}
                      href={`/users/${u.id}`}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30 transition"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                          {u.name?.charAt(0).toUpperCase() || u.email.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{u.name || u.email}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        u.plan === 'elite' ? 'bg-violet-100 text-violet-700' :
                        u.plan === 'pro' ? 'bg-amber-100 text-amber-700' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {u.plan}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 Segments auto-update in real-time based on user behavior. Use them to:
          send targeted notifications, identify upsell opportunities, and prevent churn.
          Click any user to see their full profile.
        </p>
      </div>
    </div>
  )
}
