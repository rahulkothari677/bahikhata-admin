'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ScrollText, ChevronLeft, ChevronRight, Search, Loader2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { AuditRow } from '@/components/admin/audit-row'

const PAGE_SIZE = 20

export default function AuditLogPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-log'],
    queryFn: async () => {
      const r = await fetch('/api/admin/audit-log')
      return r.json()
    },
  })

  const allActions = data?.actions || []

  // Extract unique action types for filter dropdown
  const actionTypes = Array.from(new Set(allActions.map((a: any) => a.action as string))).sort() as string[]

  // Filter by search + action type
  const filtered = allActions.filter((action: any) => {
    const matchesSearch = !search ||
      action.description.toLowerCase().includes(search.toLowerCase()) ||
      action.admin?.email?.toLowerCase().includes(search.toLowerCase()) ||
      action.action.toLowerCase().includes(search.toLowerCase())
    const matchesAction = !actionFilter || action.action === actionFilter
    return matchesSearch && matchesAction
  })

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-slate-600" />
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every admin action is permanently recorded. Click a row to see before/after changes.
        </p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by description, admin email, or action type..."
            className="w-full pl-10 pr-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm"
        >
          <option value="">All actions</option>
          {actionTypes.map((a: string) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <ScrollText className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No audit entries found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Action</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Admin</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Description</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Target</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map((action: any) => (
                <AuditRow key={action.id} action={action} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          🔒 Audit logs are permanent and cannot be deleted. Click any row with a ▶ arrow to see the before/after diff.
          Required for: DPDP Act compliance, security forensics, dispute resolution, investor due diligence.
        </p>
      </div>
    </div>
  )
}
