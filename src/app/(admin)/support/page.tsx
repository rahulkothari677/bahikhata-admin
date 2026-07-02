'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Headphones, AlertCircle, CheckCircle2, Clock, User,
  TrendingUp, Activity, Zap, ChevronLeft, ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import { toast as sonnerToast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PRIORITY_BADGE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

const STATUS_BADGE: Record<string, 'danger' | 'warning' | 'success' | 'neutral'> = {
  open: 'danger',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
}

const PAGE_SIZE = 20

export default function SupportPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null)
  const [response, setResponse] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'closed'>('open')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high' | 'medium' | 'low'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // ============ OVERVIEW DATA ============
  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-support-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/support?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ LIST DATA ============
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-support-list', statusFilter, priorityFilter, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: 'list',
        status: statusFilter,
        priority: priorityFilter,
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/support?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list',
    staleTime: 30 * 1000,
  })

  // ============ UPDATE MUTATION ============
  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => {
      const r = await fetch(`/api/admin/support/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      sonnerToast.success(data.message || 'Ticket updated')
      queryClient.invalidateQueries({ queryKey: ['admin-support-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-support-overview'] })
      setSelectedTicket(null)
      setResponse('')
    },
    onError: (err: Error) => {
      sonnerToast.error('Failed to update ticket', { description: err.message })
    },
  })

  // ============ DERIVED ============
  const tickets = listData?.tickets || []
  const total = listData?.pagination?.total || 0
  const totalPages = listData?.pagination?.totalPages || 0
  const selected = tickets.find((t: any) => t.id === selectedTicket)
  const ov = overviewData?.overview || {}

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Support Tickets"
        description="Manage user-reported issues and feature requests · bulk aggregate + paginated"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Tickets', icon: Headphones },
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
              title="Failed to load overview"
              description="Please try refreshing the page"
            />
          ) : (
            <>
              {/* 4 KPI cards */}
              <KPIGrid>
                <KPICard
                  label="Active Tickets"
                  value={String(ov.activeTotal || 0)}
                  icon={Clock}
                  iconColor="text-amber-600"
                  sublabel={`${ov.openCount || 0} open · ${ov.inProgressCount || 0} in progress`}
                />
                <KPICard
                  label="Urgent (Active)"
                  value={String(ov.urgentCount || 0)}
                  icon={Zap}
                  iconColor="text-red-600"
                  sublabel="Open or in-progress urgent tickets"
                />
                <KPICard
                  label="Resolved + Closed"
                  value={String(ov.resolvedTotal || 0)}
                  icon={CheckCircle2}
                  iconColor="text-emerald-600"
                  sublabel={`${ov.resolvedCount || 0} resolved · ${ov.closedCount || 0} closed`}
                />
                <KPICard
                  label="New (Last 7 Days)"
                  value={String(ov.newTickets7d || 0)}
                  icon={Activity}
                  iconColor="text-blue-600"
                  sublabel="Total tickets created this week"
                />
              </KPIGrid>

              {/* Category distribution */}
              <ContentCard title="Active Tickets by Category">
                {(overviewData?.categoryDistribution || []).length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No active tickets"
                    description="All tickets are resolved or closed"
                  />
                ) : (
                  <div className="p-4 space-y-2">
                    {(overviewData?.categoryDistribution || []).map((c: any) => {
                      const max = Math.max(...(overviewData?.categoryDistribution || []).map((x: any) => x.count), 1)
                      const pct = Math.round((c.count / max) * 100)
                      return (
                        <div key={c.category} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium capitalize">{c.category}</span>
                            <span className="text-xs text-muted-foreground">{c.count} active</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How data is computed (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Bulk Aggregate Queries:</p>
                    <ul className="space-y-0.5">
                      <li>• 7 parallel <code className="text-[11px] bg-muted px-1 rounded">count()</code> + <code className="text-[11px] bg-muted px-1 rounded">groupBy()</code> for KPIs</li>
                      <li>• Category distribution via <code className="text-[11px] bg-muted px-1 rounded">groupBy(category)</code> — DB-side</li>
                      <li>• List tab: <code className="text-[11px] bg-muted px-1 rounded">findMany</code> with skip/take (20/page)</li>
                      <li>• Server-side search by subject, message, or user email</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Performance & Scale:</p>
                    <ul className="space-y-0.5">
                      <li>• Overview tab: ~50ms (7 parallel count queries)</li>
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
          {/* Search + filters */}
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1">
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setPage(1) }}
                placeholder="Search by subject, message, or user email..."
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'open', 'in_progress', 'resolved', 'closed'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                    statusFilter === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {s === 'all' ? 'All Status' : s.replace('_', ' ')}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'urgent', 'high', 'medium', 'low'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => { setPriorityFilter(p); setPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                    priorityFilter === p
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Two-column: list + detail */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* List */}
            <div className="lg:col-span-1 space-y-2 max-h-[600px] overflow-y-auto">
              {listLoading ? (
                <LoadingSkeleton rows={6} />
              ) : tickets.length === 0 ? (
                <EmptyState
                  icon={Headphones}
                  title="No tickets found"
                  description={search || statusFilter !== 'all' || priorityFilter !== 'all'
                    ? "Try adjusting your filters"
                    : "No support tickets yet"}
                />
              ) : (
                tickets.map((ticket: any) => (
                  <button
                    key={ticket.id}
                    onClick={() => setSelectedTicket(ticket.id)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      selectedTicket === ticket.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{ticket.user?.email}</p>
                      </div>
                      <Badge variant={STATUS_BADGE[ticket.status] || 'neutral'}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant={PRIORITY_BADGE[ticket.priority] || 'neutral'}>
                        {ticket.priority}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(ticket.createdAt)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Detail */}
            <div className="lg:col-span-2">
              {selected ? (
                <ContentCard title={`Ticket #${selected.id.slice(-6)}`}>
                  <div className="p-4 space-y-4">
                    {/* Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={PRIORITY_BADGE[selected.priority] || 'neutral'}>
                        {selected.priority}
                      </Badge>
                      <Badge variant={STATUS_BADGE[selected.status] || 'neutral'}>
                        {selected.status.replace('_', ' ')}
                      </Badge>
                      <Badge variant="neutral">{selected.category}</Badge>
                    </div>

                    {/* Subject + message */}
                    <div>
                      <h2 className="text-lg font-bold">{selected.subject}</h2>
                      <p className="text-sm text-muted-foreground mt-1">{selected.message}</p>
                    </div>

                    {/* User info */}
                    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <Link
                          href={`/users/${selected.user?.id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {selected.user?.name || selected.user?.email}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {selected.user?.email} · {selected.user?.plan} plan
                        </p>
                      </div>
                    </div>

                    {/* Previous response */}
                    {selected.response && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
                        <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">
                          Admin Response:
                        </p>
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
                      <label className="text-xs font-medium text-muted-foreground block mb-1">
                        Response
                      </label>
                      <textarea
                        value={response}
                        onChange={(e) => setResponse(e.target.value)}
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
                        disabled={updateMutation.isPending}
                        className="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 transition disabled:opacity-50"
                      >
                        Assign to Me
                      </button>
                      <button
                        onClick={() => updateMutation.mutate({
                          id: selected.id,
                          body: { response, status: 'resolved' },
                        })}
                        disabled={!response || updateMutation.isPending}
                        className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 transition disabled:opacity-50"
                      >
                        Resolve with Response
                      </button>
                      <button
                        onClick={() => updateMutation.mutate({
                          id: selected.id,
                          body: { response },
                        })}
                        disabled={!response || updateMutation.isPending}
                        className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition disabled:opacity-50"
                      >
                        Send Response Only
                      </button>
                      <button
                        onClick={() => updateMutation.mutate({
                          id: selected.id,
                          body: { priority: 'urgent' },
                        })}
                        disabled={updateMutation.isPending}
                        className="px-3 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition disabled:opacity-50"
                      >
                        Mark Urgent
                      </button>
                      <button
                        onClick={() => updateMutation.mutate({
                          id: selected.id,
                          body: { status: 'closed' },
                        })}
                        disabled={updateMutation.isPending}
                        className="px-3 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80 transition disabled:opacity-50"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </ContentCard>
              ) : (
                <ContentCard>
                  <EmptyState
                    icon={Headphones}
                    title="Select a ticket to view details"
                    description="Click any ticket on the left to see full message and respond"
                  />
                </ContentCard>
              )}
            </div>
          </div>

          {/* Pagination */}
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
