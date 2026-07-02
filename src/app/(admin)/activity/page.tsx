'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Activity, Users, DollarSign, Coins, Crown, Shield } from 'lucide-react'
import { PageHeader, KPIGrid, KPICard, ContentCard, EmptyState, LoadingSkeleton, Pagination, SearchBar, Badge } from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
]

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'signup', label: 'Signups' },
  { key: 'transaction', label: 'Transactions' },
  { key: 'ai_call', label: 'AI Calls' },
  { key: 'subscription', label: 'Subscriptions' },
  { key: 'admin_action', label: 'Admin' },
]

const EVENT_BADGE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  signup: 'info',
  transaction: 'success',
  ai_call: 'warning',
  subscription: 'info',
  admin_action: 'neutral',
}

export default function ActivityPage() {
  const [range, setRange] = useState('7d')
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-activity-v2', range, type, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ range, type, page: String(page) })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/activity?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000, // 1 min cache
  })

  const summary = data?.summary
  const events = data?.events || []
  const pagination = data?.pagination

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <PageHeader
        title="Activity Log"
        description="All events across the platform"
      />

      {/* Date range picker */}
      <div className="flex gap-2">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => { setRange(r.key); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              range === r.key ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-muted/50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Summary cards — AGGREGATE counts (scales to billions) */}
      {summary && (
        <KPIGrid>
          <KPICard label="Signups" value={formatNumber(summary.signup)} icon={Users} iconColor="text-blue-500" />
          <KPICard label="Transactions" value={formatNumber(summary.transaction)} icon={DollarSign} iconColor="text-emerald-500" />
          <KPICard label="AI Calls" value={formatNumber(summary.ai_call)} icon={Coins} iconColor="text-amber-500" />
          <KPICard label="Subscriptions" value={formatNumber(summary.subscription)} icon={Crown} iconColor="text-violet-500" />
        </KPIGrid>
      )}

      {/* Type filter tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border scrollbar-hide">
        {TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => { setType(t.key); setPage(1) }}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              type === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <SearchBar
        value={search}
        onChange={(v) => { setSearch(v); setPage(1) }}
        placeholder="Search by event title, description, or user email..."
      />

      {/* Events list */}
      <ContentCard>
        {isLoading ? (
          <LoadingSkeleton rows={8} />
        ) : events.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No events found"
            description={search || type !== 'all' ? "Try adjusting your search or filter" : "No activity in this time period"}
          />
        ) : (
          <div className="divide-y divide-border">
            {events.map((event: any) => (
              <div key={event.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition">
                <span className="text-lg flex-shrink-0 mt-0.5">{event.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${event.color}`}>{event.title}</p>
                    <Badge variant={EVENT_BADGE[event.type] || 'neutral'}>{event.type.replace('_', ' ')}</Badge>
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
            ))}
          </div>
        )}
      </ContentCard>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          pageSize={pagination.limit}
          onPageChange={setPage}
        />
      )}

      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 Summary cards use aggregate count() queries — they scale to billions of events instantly.
          The event list is server-side paginated (20 per page) with server-side search.
          At 10K+ events/day, this will switch to cursor-based pagination for deeper history.
        </p>
      </div>
    </div>
  )
}
