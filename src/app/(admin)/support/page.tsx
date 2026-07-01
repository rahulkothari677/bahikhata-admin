'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Headphones, Loader2, AlertCircle, CheckCircle2, Clock, User } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
}

const STATUS_ICONS: Record<string, any> = {
  open: AlertCircle,
  in_progress: Clock,
  resolved: CheckCircle2,
  closed: CheckCircle2,
}

const STATUS_COLORS: Record<string, string> = {
  open: 'text-red-600',
  in_progress: 'text-amber-600',
  resolved: 'text-emerald-600',
  closed: 'text-muted-foreground',
}

export default function SupportPage() {
  const queryClient = useQueryClient()
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null)
  const [response, setResponse] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-support', statusFilter],
    queryFn: async () => {
      const r = await fetch(`/api/admin/support?status=${statusFilter}`)
      return r.json()
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => {
      const r = await fetch(`/api/admin/support/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    onSuccess: (data) => {
      sonnerToast.success(data.message || 'Ticket updated')
      queryClient.invalidateQueries({ queryKey: ['admin-support'] })
      setSelectedTicket(null)
      setResponse('')
    },
    onError: () => sonnerToast.error('Failed to update ticket'),
  })

  const tickets = data?.tickets || []
  const selected = tickets.find((t: any) => t.id === selectedTicket)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Headphones className="w-6 h-6 text-blue-600" />
          Support Tickets
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage user-reported issues and feature requests</p>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {['open', 'in_progress', 'resolved', 'closed'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              statusFilter === s ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Tickets list + detail view */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* List */}
        <div className="lg:col-span-1 space-y-2 max-h-[600px] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Headphones className="w-10 h-10 mx-auto mb-2 opacity-50" />
              No {statusFilter.replace('_', ' ')} tickets
            </div>
          ) : (
            tickets.map((ticket: any) => {
              const StatusIcon = STATUS_ICONS[ticket.status] || AlertCircle
              return (
                <button
                  key={ticket.id}
                  onClick={() => setSelectedTicket(ticket.id)}
                  className={`w-full text-left p-3 rounded-lg border transition ${
                    selectedTicket === ticket.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{ticket.user?.email}</p>
                    </div>
                    <StatusIcon className={`w-4 h-4 flex-shrink-0 ${STATUS_COLORS[ticket.status]}`} />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${PRIORITY_COLORS[ticket.priority]}`}>
                      {ticket.priority}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{formatRelativeTime(ticket.createdAt)}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="bg-card rounded-xl border border-border p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${PRIORITY_COLORS[selected.priority]}`}>
                    {selected.priority}
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded bg-muted ${STATUS_COLORS[selected.status]}`}>
                    {selected.status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground">#{selected.id.slice(-6)}</span>
                </div>
                <h2 className="text-lg font-bold">{selected.subject}</h2>
                <p className="text-sm text-muted-foreground mt-1">{selected.message}</p>
              </div>

              {/* User info */}
              <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{selected.user?.name || selected.user?.email}</p>
                  <p className="text-xs text-muted-foreground">{selected.user?.email} · {selected.user?.plan} plan</p>
                </div>
              </div>

              {/* Previous response */}
              {selected.response && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">Admin Response:</p>
                  <p className="text-sm">{selected.response}</p>
                  {selected.resolvedAt && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Resolved by {selected.resolvedBy} · {formatRelativeTime(selected.resolvedAt)}
                    </p>
                  )}
                </div>
              )}

              {/* Response input */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Response</label>
                <textarea
                  value={response}
                  onChange={e => setResponse(e.target.value)}
                  rows={4}
                  placeholder="Type your response..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateMutation.mutate({
                    id: selected.id,
                    body: { status: 'in_progress', assignedTo: 'admin' },
                  })}
                  className="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600"
                >
                  Assign to Me
                </button>
                <button
                  onClick={() => updateMutation.mutate({
                    id: selected.id,
                    body: { response, status: 'resolved' },
                  })}
                  disabled={!response || updateMutation.isPending}
                  className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 disabled:opacity-50"
                >
                  Resolve with Response
                </button>
                <button
                  onClick={() => updateMutation.mutate({
                    id: selected.id,
                    body: { response },
                  })}
                  disabled={!response || updateMutation.isPending}
                  className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50"
                >
                  Send Response Only
                </button>
                <button
                  onClick={() => updateMutation.mutate({
                    id: selected.id,
                    body: { priority: 'urgent' },
                  })}
                  className="px-3 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600"
                >
                  Mark Urgent
                </button>
                <button
                  onClick={() => updateMutation.mutate({
                    id: selected.id,
                    body: { status: 'closed' },
                  })}
                  className="px-3 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border p-12 text-center text-sm text-muted-foreground">
              Select a ticket to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
