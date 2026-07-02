'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useDebounce } from '@/hooks/use-debounce'
import { Users as UsersIcon, Search, Crown, Loader2, Download, Send, Ban, Trash2, UserCog, CheckSquare, Square } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'
import { toast as sonnerToast } from 'sonner'

export default function UsersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', debouncedSearch, planFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (planFilter) params.set('plan', planFilter)
      const r = await fetch(`/api/admin/users?${params}`)
      return r.json()
    },
  })

  // Fetch health scores for all users
  const { data: healthData } = useQuery({
    queryKey: ['admin-health'],
    queryFn: async () => {
      const r = await fetch('/api/admin/health')
      return r.json()
    },
  })

  // Build a lookup map of userId → health score
  const healthMap: Record<string, any> = {}
  if (healthData?.scores) {
    for (const s of healthData.scores) {
      healthMap[s.userId] = s
    }
  }

  const bulkMutation = useMutation({
    mutationFn: async (body: any) => {
      const r = await fetch('/api/admin/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Bulk operation failed')
      return data
    },
    onSuccess: (data) => {
      if (bulkAction === 'export' && data.csv) {
        // Download CSV
        const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = data.filename || 'users-export.csv'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        sonnerToast.success(`Exported ${data.count} users to CSV`)
      } else {
        sonnerToast.success(data.message || `Bulk ${bulkAction} completed`)
      }
      setSelectedIds(new Set())
      setBulkAction('')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (err: Error) => {
      sonnerToast.error(err.message)
    },
  })

  const users = data?.users || []

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === users.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(users.map((u: any) => u.id)))
    }
  }

  const handleBulkAction = () => {
    if (!bulkAction || selectedIds.size === 0) return
    const ids = Array.from(selectedIds)

    if (bulkAction === 'export') {
      bulkMutation.mutate({ action: 'export', userIds: ids })
    } else if (bulkAction === 'change_plan') {
      const plan = prompt('Enter new plan (free, pro, elite):', 'pro')
      if (!plan) return
      bulkMutation.mutate({ action: 'change_plan', userIds: ids, params: { plan } })
    } else if (bulkAction === 'message') {
      const title = prompt('Notification title:')
      if (!title) return
      const message = prompt('Notification message:')
      if (!message) return
      bulkMutation.mutate({ action: 'message', userIds: ids, params: { title, message } })
    } else if (bulkAction === 'ban') {
      if (confirm(`Ban ${ids.length} users? This sets them to free plan + cancelled.`)) {
        bulkMutation.mutate({ action: 'ban', userIds: ids })
      }
    } else if (bulkAction === 'delete') {
      if (confirm(`PERMANENTLY DELETE ${ids.length} users? This CANNOT be undone!`)) {
        bulkMutation.mutate({ action: 'delete', userIds: ids, params: { confirm: 'DELETE_PERMANENTLY' } })
      }
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage all BahiKhata Pro users</p>
        </div>
        <button
          onClick={() => {
            const ids = users.map((u: any) => u.id)
            if (ids.length === 0) {
              sonnerToast.error('No users to export')
              return
            }
            sonnerToast.loading('Generating CSV...', { id: 'csv-export' })
            fetch('/api/admin/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'export', userIds: ids }),
            })
            .then(r => r.json())
            .then(data => {
              if (!data.success) throw new Error(data.error || 'Export failed')
              // Download CSV
              const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = data.filename || 'users-export.csv'
              a.style.display = 'none'
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              setTimeout(() => URL.revokeObjectURL(url), 2000)
              sonnerToast.success(`Exported ${data.count} users to CSV`, { id: 'csv-export' })
            })
            .catch(err => {
              sonnerToast.error('CSV export failed', {
                description: String(err.message || err).slice(0, 200),
                id: 'csv-export',
                duration: 8000,
              })
            })
          }}
          disabled={users.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm font-medium hover:bg-muted/50 transition disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or name..."
            className="w-full pl-10 pr-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="elite">Elite</option>
        </select>
      </div>

      {/* Bulk action bar (appears when users selected) */}
      {selectedIds.size > 0 && (
        <div className="bg-primary/5 border border-primary/30 rounded-lg p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{selectedIds.size} user(s) selected</span>
          <div className="flex-1" />
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm"
          >
            <option value="">Choose action...</option>
            <option value="export">📥 Export as CSV</option>
            <option value="change_plan">🔄 Change Plan</option>
            <option value="message">💬 Send Notification</option>
            <option value="ban">🚫 Ban (free + cancelled)</option>
            <option value="delete">🗑️ Delete Permanently</option>
          </select>
          <button
            onClick={handleBulkAction}
            disabled={!bulkAction || bulkMutation.isPending}
            className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {bulkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Execute
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <UsersIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No users found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground">
                    {selectedIds.size === users.length && users.length > 0
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-4 h-4" />
                    }
                  </button>
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">User</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Plan</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Transactions</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">AI Calls</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Health</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Joined</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user: any) => (
                <tr key={user.id} className={`hover:bg-muted/30 transition ${selectedIds.has(user.id) ? 'bg-primary/5' : ''}`}>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleSelect(user.id)} className="text-muted-foreground hover:text-foreground">
                      {selectedIds.has(user.id)
                        ? <CheckSquare className="w-4 h-4 text-primary" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/users/${user.id}`} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                        {user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{user.name || user.email}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      user.plan === 'elite' ? 'bg-violet-100 text-violet-700' :
                      user.plan === 'pro' ? 'bg-amber-100 text-amber-700' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {user.plan === 'elite' && <Crown className="w-3 h-3 inline mr-1" />}
                      {user.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">{user._count.transactions}</td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">{user._count.aiUsageLogs}</td>
                  <td className="px-4 py-3">
                    {healthMap[user.id] ? (
                      <span className={`text-xs font-bold ${healthMap[user.id].color}`}>
                        {healthMap[user.id].score} · {healthMap[user.id].label}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatRelativeTime(user.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/users/${user.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <UserCog className="w-3.5 h-3.5" />
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination info */}
      {data?.pagination && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {users.length} of {data.pagination.total} users</span>
          <span>Page {data.pagination.page} of {data.pagination.totalPages}</span>
        </div>
      )}
    </div>
  )
}
