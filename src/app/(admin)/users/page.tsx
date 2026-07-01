'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useDebounce } from '@/hooks/use-debounce'
import { Users as UsersIcon, Search, Crown, Loader2 } from 'lucide-react'
import { formatINR, formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'

export default function UsersPage() {
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('')
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage all BahiKhata Pro users</p>
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

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : data?.users?.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <UsersIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No users found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">User</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Plan</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Transactions</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">AI Calls</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.users?.map((user: any) => (
                <tr key={user.id} className="hover:bg-muted/30 transition cursor-pointer">
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
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatRelativeTime(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {data.users.length} of {data.pagination.total} users
          </p>
          <div className="flex gap-1">
            {/* Pagination buttons would go here */}
          </div>
        </div>
      )}
    </div>
  )
}
