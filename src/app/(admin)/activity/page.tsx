'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { PageHeader, ContentCard, EmptyState, LoadingSkeleton, Pagination, SearchBar, Badge } from '@/components/admin/ui'
import { formatRelativeTime } from '@/lib/utils'

const PAGE_SIZE = 20

const EVENT_CONFIG: Record<string, { color: string; badge: 'success' | 'info' | 'warning' | 'neutral' | 'danger' }> = {
  signup: { color: 'text-blue-600', badge: 'info' },
  transaction: { color: 'text-emerald-600', badge: 'success' },
  ai_call: { color: 'text-amber-600', badge: 'warning' },
  subscription: { color: 'text-violet-600', badge: 'info' },
  admin_action: { color: 'text-slate-600', badge: 'neutral' },
}

export default function ActivityPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-activity'],
    queryFn: async () => {
      const r = await fetch('/api/admin/activity')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    refetchInterval: 60000, // 60 seconds (not 15 — reduces server load at scale)
  })

  const allEvents = data?.events || []

  // Filter by search + type
  const filtered = allEvents.filter((e: any) => {
    const matchesSearch = !search ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase()) ||
      (e.user && e.user.toLowerCase().includes(search.toLowerCase()))
    const matchesType = !typeFilter || e.type === typeFilter
    return matchesSearch && matchesType
  })

  // Pagination (client-side for now — server-side when events exceed 10K/day)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const eventTypes = Array.from(new Set(allEvents.map((e: any) => e.type as string))) as string[]

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Activity Log"
        description={`${data?.summary?.total || 0} events in the last 7 days`}
      />

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBar
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
          placeholder="Search by event title, description, or user..."
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm"
        >
          <option value="">All types</option>
          {eventTypes.map((t: string) => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Events list */}
      <ContentCard>
        {isLoading ? (
          <LoadingSkeleton rows={8} />
        ) : paginated.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No events found"
            description={search || typeFilter ? "Try adjusting your search or filter" : "No activity in the last 7 days"}
          />
        ) : (
          <div className="divide-y divide-border">
            {paginated.map((event: any) => {
              const config = EVENT_CONFIG[event.type] || EVENT_CONFIG.admin_action
              return (
                <div key={event.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition">
                  <span className="text-lg flex-shrink-0 mt-0.5">{event.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${config.color}`}>{event.title}</p>
                      <Badge variant={config.badge}>{event.type.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.description}</p>
                    {event.user && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">User: {event.user}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                    {formatRelativeTime(event.timestamp)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </ContentCard>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />

      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 Activity log shows events from the last 7 days. At scale, this will use cursor-based
          pagination (WHERE createdAt &lt; ?) instead of offset, to handle millions of events efficiently.
          Auto-refreshes every 60 seconds.
        </p>
      </div>
    </div>
  )
}
