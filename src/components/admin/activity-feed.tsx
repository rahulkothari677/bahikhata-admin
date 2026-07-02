'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity, Loader2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { EmptyState, LoadingSkeleton } from '@/components/admin/ui'

export function ActivityFeedClient() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-activity'],
    queryFn: async () => {
      const r = await fetch('/api/admin/activity')
      return r.json()
    },
    refetchInterval: 15000,
  })

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          Live Activity Feed
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {data?.summary ? `${data.summary.total} events · auto-refresh 15s` : 'Loading...'}
        </span>
      </div>

      {isLoading ? (
        <LoadingSkeleton rows={5} />
      ) : data?.events?.length === 0 ? (
        <EmptyState icon={Activity} title="No activity yet" description="Events from the last 7 days will appear here" />
      ) : (
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {data?.events?.map((event: any) => (
            <div key={event.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
              <span className="text-base flex-shrink-0 mt-0.5">{event.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${event.color}`}>{event.title}</p>
                <p className="text-xs text-muted-foreground truncate">{event.description}</p>
              </div>
              <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                {formatRelativeTime(event.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
