'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useDebounce } from '@/hooks/use-debounce'

const PAGE_SIZE = 20

export default function SegmentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const segmentId = params.segmentId as string

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 300)

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

  if (!data?.success) return <div className="p-6 text-muted-foreground">Failed to load</div>

  const segment = data.segments.find((s: any) => s.id === segmentId)

  if (!segment) {
    return <div className="p-6 text-muted-foreground">Segment not found</div>
  }

  // Filter users by search
  const filteredUsers = debouncedSearch
    ? segment.users.filter((u: any) =>
        u.email.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (u.name && u.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
      )
    : segment.users

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE)
  const paginatedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="p-6 space-y-6">
      {/* Back + header */}
      <button
        onClick={() => router.push('/segments')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to segments
      </button>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="text-3xl">{segment.icon}</span>
          {segment.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{segment.description}</p>
        <p className="text-xs text-muted-foreground mt-1">{segment.users.length} users in this segment</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by name or email..."
          className="w-full pl-10 pr-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Users table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {paginatedUsers.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No users found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">User</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Email</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Plan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedUsers.map((user: any) => (
                <tr key={user.id} className="hover:bg-muted/30 transition">
                  <td className="px-4 py-3">
                    <Link href={`/users/${user.id}`} className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                        {user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">{user.name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      user.plan === 'elite' ? 'bg-violet-100 text-violet-700' :
                      user.plan === 'pro' ? 'bg-amber-100 text-amber-700' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {user.plan}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length}
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
    </div>
  )
}
