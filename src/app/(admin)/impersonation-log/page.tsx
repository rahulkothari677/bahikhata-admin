'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  UserCheck, TrendingUp, Clock, Users, AlertCircle,
  ChevronDown, ChevronRight, ShieldAlert, Lock,
} from 'lucide-react'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const PAGE_SIZE = 20

export default function ImpersonationLogPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-impersonation-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/impersonation-log?tab=overview')
      if (r.status === 403) { setAccessDenied(true); return { success: false } }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-impersonation-list', page],
    queryFn: async () => {
      const r = await fetch(`/api/admin/impersonation-log?tab=list&page=${page}`)
      if (r.status === 403) { setAccessDenied(true); return { success: false } }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list' && !accessDenied,
    staleTime: 30 * 1000,
  })

  if (accessDenied) {
    return (
      <div className="p-6">
        <PageHeader title="Impersonation Log" description="Audit trail of admin impersonation sessions" />
        <EmptyState
          icon={Lock}
          title="Access Denied"
          description="Only founders can view impersonation logs. Your role doesn't have permission."
        />
      </div>
    )
  }

  const ov = overview?.overview || {}
  const logs = listData?.logs || []
  const total = listData?.total || 0
  const totalPages = listData?.totalPages || 0

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Impersonation Log"
        description="Audit trail of admin impersonation sessions · founder-only · DPDP compliant"
      />

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Sessions', icon: UserCheck },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW TAB */}
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
              <LoadingSkeleton rows={4} />
            </>
          ) : !overview?.success ? (
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard label="Total Sessions" value={formatNumber(ov.totalCount || 0)} icon={UserCheck} iconColor="text-violet-600" sublabel="All time" />
                <KPICard label="Today" value={formatNumber(ov.todayCount || 0)} icon={Clock} iconColor="text-amber-600" sublabel="Last 24 hours" />
                <KPICard label="This Week" value={formatNumber(ov.weekCount || 0)} icon={TrendingUp} iconColor="text-blue-600" sublabel="Last 7 days" />
                <KPICard label="Unique Admins" value={formatNumber(ov.uniqueAdmins || 0)} icon={Users} iconColor="text-emerald-600" sublabel={`${ov.uniqueUsers || 0} unique users impersonated`} />
              </KPIGrid>

              {/* Security + compliance */}
              <div className="bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-200 dark:border-red-900 p-4">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                      Impersonation Security & Compliance
                    </p>
                    <ul className="text-xs text-red-700 dark:text-red-300 mt-1 space-y-0.5">
                      <li>• <strong>Founder-only</strong>: only founder role can impersonate users</li>
                      <li>• <strong>Reason required</strong>: admin must provide a reason (min 10 chars)</li>
                      <li>• <strong>5-minute expiry</strong>: impersonation token expires in 5 minutes</li>
                      <li>• <strong>Single-use token</strong>: token deleted after use</li>
                      <li>• <strong>Full audit trail</strong>: admin, target user, reason, IP, user agent logged</li>
                      <li>• <strong>DPDP compliant</strong>: all access to user data is tracked and auditable</li>
                      <li>• <strong>Token hash only</strong>: actual token never stored (SHA-256 hash only)</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How impersonation works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Process:</p>
                    <ul className="space-y-0.5">
                      <li>1. Founder selects a user from Users page</li>
                      <li>2. Enters a reason (e.g. "debugging payment issue")</li>
                      <li>3. System generates one-time token (32 random bytes)</li>
                      <li>4. Token hash + metadata logged to AdminAction</li>
                      <li>5. Founder gets a link (expires in 5 min)</li>
                      <li>6. Clicking link logs in AS the user in main app</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Use Cases:</p>
                    <ul className="space-y-0.5">
                      <li>• Debug user-specific issues (can't see their data)</li>
                      <li>• Verify feature works correctly for specific plan tier</li>
                      <li>• Help user with account setup (with their permission)</li>
                      <li>• Investigate support tickets first-hand</li>
                      <li>• <strong>Never</strong> use for data access without user consent</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* LIST TAB */}
      {tab === 'list' && (
        <ContentCard title={`Impersonation Sessions — ${total} total`}>
          {listLoading ? (
            <LoadingSkeleton rows={8} />
          ) : logs.length === 0 ? (
            <EmptyState icon={UserCheck} title="No impersonation sessions" description="No admin has impersonated any user yet" />
          ) : (
            <div className="divide-y divide-border">
              {logs.map((log: any) => {
                const meta = log.metadata || {}
                return (
                  <div key={log.id}>
                    <button
                      onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                      className="w-full text-left p-4 hover:bg-muted/30 transition"
                    >
                      <div className="flex items-start gap-3">
                        {expanded === log.id ? <ChevronDown className="w-4 h-4 mt-1 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 mt-1 text-muted-foreground flex-shrink-0" />}
                        <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-950/30 flex items-center justify-center flex-shrink-0">
                          <UserCheck className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-sm font-medium">{log.adminName || log.adminEmail || 'Unknown admin'}</p>
                            <span className="text-xs text-muted-foreground">→</span>
                            <p className="text-sm">{meta.targetUserEmail || meta.targetUserName || log.targetUserId?.slice(0, 12) || 'Unknown user'}</p>
                            {meta.targetUserPlan && <Badge variant="info">{meta.targetUserPlan}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Reason: {meta.reason || 'No reason provided'}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{formatRelativeTime(log.createdAt)}</span>
                            {log.ip && <span>· IP: <span className="font-mono">{log.ip}</span></span>}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded details */}
                    {expanded === log.id && (
                      <div className="bg-muted/20 p-4 border-t border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Full Details</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-muted-foreground">Admin</p>
                            <p className="font-medium">{log.adminEmail}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Target User ID</p>
                            <p className="font-mono">{log.targetUserId}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Target Email</p>
                            <p className="font-medium">{meta.targetUserEmail || '—'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Target Name</p>
                            <p className="font-medium">{meta.targetUserName || '—'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Target Plan</p>
                            <p className="font-medium">{meta.targetUserPlan || '—'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Token Expiry</p>
                            <p className="font-medium">{meta.expiresAt ? new Date(meta.expiresAt).toLocaleString() : '—'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">IP Address</p>
                            <p className="font-mono">{log.ip || '—'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">User Agent</p>
                            <p className="font-mono text-[10px] truncate max-w-xs" title={log.userAgent}>{log.userAgent || '—'}</p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="text-muted-foreground">Token Hash (SHA-256)</p>
                            <p className="font-mono text-[10px] break-all">{meta.tokenHash || '—'}</p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="text-muted-foreground">Full Description</p>
                            <p className="text-sm">{log.description}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ContentCard>
      )}

      {total > 0 && (
        <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}
    </div>
  )
}
