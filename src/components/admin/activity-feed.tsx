'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity, Loader2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

export function ActivityFeedClient() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-activity'],
    queryFn: async () => {
      const r = await fetch('/api/admin/activity')
      return r.json()
    },
    refetchInterval: 15000, // refresh every 15 seconds
  })

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-500" />
        Live Activity Feed
        {data?.summary && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {data.summary.total} events in last 7 days · auto-refresh 15s
          </span>
        )}
      </h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : data?.events?.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No activity in the last 7 days</p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {data?.events?.map((event: any) => (
            <div key={event.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
              <span className="text-lg flex-shrink-0 mt-0.5">{event.icon}</span>
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
