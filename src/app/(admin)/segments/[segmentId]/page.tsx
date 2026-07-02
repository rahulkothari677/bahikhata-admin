'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Megaphone } from 'lucide-react'
import { PageHeader, ContentCard, EmptyState, LoadingSkeleton, SearchBar, Pagination, Badge } from '@/components/admin/ui'
import { formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'

const PAGE_SIZE = 20

const SEGMENT_NAMES: Record<string, string> = {
  power_users: '⚡ Power Users',
  whales: '🐋 Whales',
  new_users: '🆕 New Users',
  at_risk: '⚠️ At Risk',
  churned: '💀 Churned',
  ai_power: '🤖 AI Power Users',
  free_active: '🆓 Free Tier Active',
  paying: '👑 Paying Users',
  abandoned: '🚫 Trial Abandoned',
  rising_stars: '🌟 Rising Stars',
}

export default function SegmentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const segmentId = params.segmentId as string

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-segment-detail', segmentId, page, search],
    queryFn: async () => {
      const params = new URLSearchParams({ segmentId, page: String(page) })
      if (search) params.set('search', search)
      const r = await fetch(`/api/admin/segments?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const users = data?.users || []
  const total = data?.total || 0
  const totalPages = data?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/segments')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to segments
      </button>

      <PageHeader
        title={SEGMENT_NAMES[segmentId] || 'Segment'}
        description={`${total} users in this segment`}
        actions={
          <button
            onClick={() => router.push(`/campaigns?segment=${segmentId}`)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
          >
            <Megaphone className="w-4 h-4" />
            Create Campaign
          </button>
        }
      />

      {/* Search */}
      <SearchBar
        value={search}
        onChange={(v) => { setSearch(v); setPage(1) }}
        placeholder="Search by name or email..."
      />

      {/* Users table */}
      <ContentCard>
        {isLoading ? (
          <LoadingSkeleton rows={8} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={ArrowLeft}
            title="No users found"
            description={search ? "Try adjusting your search" : "No users in this segment"}
          />
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">User</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Email</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Plan</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user: any) => (
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
                    <Badge variant={user.plan === 'elite' ? 'info' : user.plan === 'pro' ? 'warning' : 'neutral'}>
                      {user.plan}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {formatRelativeTime(user.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ContentCard>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  )
}
