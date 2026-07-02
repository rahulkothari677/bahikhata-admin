'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Shield, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle,
  Lock, Database, Activity, CheckCircle2, XCircle, ChevronLeft,
  ChevronRight, Users, Cpu,
} from 'lucide-react'
import Link from 'next/link'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  Pagination, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'fraud' | 'security'

const PAGE_SIZE = 20

export default function RiskPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [fraudPage, setFraudPage] = useState(1)
  const [securityPage, setSecurityPage] = useState(1)

  // ============ OVERVIEW DATA ============
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-risk-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/risk?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000, // 1 min cache (was 30s polling)
  })

  // ============ FRAUD DETAIL DATA ============
  const { data: fraudData, isLoading: fraudLoading } = useQuery({
    queryKey: ['admin-risk-fraud', fraudPage],
    queryFn: async () => {
      const r = await fetch(`/api/admin/risk?tab=fraud&page=${fraudPage}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'fraud',
    staleTime: 60 * 1000,
  })

  // ============ SECURITY DETAIL DATA ============
  const { data: securityData, isLoading: securityLoading } = useQuery({
    queryKey: ['admin-risk-security', securityPage],
    queryFn: async () => {
      const r = await fetch(`/api/admin/risk?tab=security&page=${securityPage}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'security',
    staleTime: 60 * 1000,
  })

  // ============ DERIVED ============
  const fraud = overview?.fraud || {}
  const dpdp = overview?.dpdp || {}
  const security = overview?.security || {}
  const breachReadiness = overview?.breachReadiness || {}

  const riskLevel = fraud.riskScore?.level || 'low'
  const riskScore = fraud.riskScore?.score || 0

  const RiskIcon = riskLevel === 'critical' ? ShieldX :
                   riskLevel === 'high' ? ShieldAlert :
                   riskLevel === 'medium' ? Shield : ShieldCheck

  const riskColor = riskLevel === 'critical' ? 'text-red-600 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900' :
                    riskLevel === 'high' ? 'text-orange-600 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900' :
                    riskLevel === 'medium' ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900' :
                    'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Risk & Compliance"
        description="Fraud detection, DPDP compliance, security monitoring · bulk aggregate queries"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: Activity },
          { id: 'fraud' as const, label: 'Fraud Detection', icon: AlertTriangle },
          { id: 'security' as const, label: 'Security', icon: Lock },
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
              <div className="h-24 bg-card rounded-xl border border-border animate-pulse" />
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
          ) : !overview?.success ? (
            <EmptyState
              icon={Shield}
              title="Failed to load risk data"
              description="Please try refreshing the page"
            />
          ) : (
            <>
              {/* Overall risk score banner */}
              <div className={`rounded-xl border p-4 ${riskColor}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide opacity-70">Overall Risk Level</p>
                    <p className="text-3xl font-bold mt-1 capitalize">{riskLevel}</p>
                    <p className="text-xs opacity-70 mt-1">Risk score: {riskScore}/100</p>
                  </div>
                  <RiskIcon className="w-12 h-12 opacity-80" />
                </div>
              </div>

              {/* 4 KPI cards */}
              <KPIGrid>
                <KPICard
                  label="Duplicate Phones"
                  value={formatNumber(fraud.duplicatePhoneCount || 0)}
                  icon={AlertTriangle}
                  iconColor="text-amber-600"
                  sublabel="Same phone, multiple accounts"
                />
                <KPICard
                  label="Inactive New Users"
                  value={formatNumber(fraud.inactiveNewUsers || 0)}
                  icon={Users}
                  iconColor="text-orange-600"
                  sublabel="No activity after 7 days"
                />
                <KPICard
                  label="Failed Logins (24h)"
                  value={formatNumber(security.failedLogins24h || 0)}
                  icon={Lock}
                  iconColor="text-red-600"
                  sublabel={`Success rate: ${security.loginSuccessRate || 0}%`}
                />
                <KPICard
                  label="Brute Force IPs"
                  value={formatNumber(security.bruteForceIpCount || 0)}
                  icon={ShieldAlert}
                  iconColor="text-red-600"
                  sublabel="5+ failed login attempts"
                />
              </KPIGrid>

              {/* DPDP + Breach Readiness side-by-side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ContentCard title="DPDP Act Compliance">
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <span className="text-sm">Users with data (need consent)</span>
                      <span className="font-bold">{formatNumber(dpdp.usersWithData || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <span className="text-sm">Data export requests</span>
                      <span className="font-bold">{dpdp.dataExportRequests || 0}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <span className="text-sm">Data deletion requests</span>
                      <span className="font-bold">{dpdp.dataDeleteRequests || 0}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <span className="text-sm">Recent requests (30 days)</span>
                      <span className="font-bold">{dpdp.recentDataRequests || 0}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm font-medium">Compliance Score</span>
                      <span className={`font-bold text-lg ${(dpdp.complianceScore || 0) >= 80 ? 'text-emerald-600' : (dpdp.complianceScore || 0) >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                        {dpdp.complianceScore || 0}/100
                      </span>
                    </div>
                  </div>
                </ContentCard>

                <ContentCard title="Data Breach Readiness">
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <ReadinessItem label="Encryption at rest" enabled={breachReadiness.encryptionAtRest} />
                    <ReadinessItem label="HTTPS in transit" enabled={breachReadiness.encryptionInTransit} />
                    <ReadinessItem label="Audit log enabled" enabled={breachReadiness.auditLogEnabled} />
                    <ReadinessItem label="Rate limiting" enabled={breachReadiness.rateLimitingEnabled} />
                    <ReadinessItem label="CSRF protection" enabled={breachReadiness.csrfProtection} />
                    <ReadinessItem label="2FA available" enabled={breachReadiness.twoFactorAvailable} />
                    <ReadinessItem label="IP allowlist" enabled={breachReadiness.ipAllowlistConfigured} />
                    <ReadinessItem label="Backup verification" enabled={false} />
                  </div>
                </ContentCard>
              </div>

              {/* Breach response playbook */}
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-2">
                  🚨 Data Breach Response Playbook (DPDP Act: 72-hour reporting)
                </p>
                <ol className="text-xs text-amber-700 dark:text-amber-300 space-y-1 ml-4 list-decimal">
                  <li>Detect: Sentry alert or user report triggers investigation</li>
                  <li>Assess: Determine scope — which users, what data, how accessed</li>
                  <li>Contain: Block the attack vector (revoke tokens, block IPs, rotate secrets)</li>
                  <li>Notify: Email affected users within 72 hours</li>
                  <li>Report: File report with Data Protection Board of India</li>
                  <li>Document: Log everything in AuditLog for forensics</li>
                  <li>Remediate: Fix the vulnerability that caused the breach</li>
                  <li>Review: Post-mortem analysis to prevent recurrence</li>
                </ol>
              </div>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How data is computed (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Bulk Aggregate Queries:</p>
                    <ul className="space-y-0.5">
                      <li>• 10 parallel <code className="text-[11px] bg-muted px-1 rounded">count()</code> + <code className="text-[11px] bg-muted px-1 rounded">groupBy()</code> for KPIs</li>
                      <li>• Phone duplicate detection: <code className="text-[11px] bg-muted px-1 rounded">groupBy(phone)</code> + JS filter (DB-side, not findMany)</li>
                      <li>• Brute force IP detection: <code className="text-[11px] bg-muted px-1 rounded">groupBy(ip)</code> on failed login logs</li>
                      <li>• <strong>NO findMany on users table</strong> (was loading ALL users into memory)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Performance & Scale:</p>
                    <ul className="space-y-0.5">
                      <li>• Overview tab: ~50ms (10 parallel aggregate queries)</li>
                      <li>• Fraud tab: ~100ms (groupBy + paginated findMany)</li>
                      <li>• Security tab: ~100ms (groupBy + paginated)</li>
                      <li>• All queries: <code className="text-[11px] bg-muted px-1 rounded">withTimeout(5000ms)</code> + <code className="text-[11px] bg-muted px-1 rounded">.catch()</code> fallback</li>
                      <li>• Removed 30s polling (was server load) → 60s cache</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ FRAUD TAB ============ */}
      {tab === 'fraud' && (
        <>
          {fraudLoading ? (
            <LoadingSkeleton rows={10} />
          ) : !fraudData?.success ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load fraud data"
              description="Please try refreshing"
            />
          ) : (
            <>
              {/* Duplicate phones */}
              <ContentCard title={`Duplicate Phone Numbers — ${fraudData.duplicatePhonesTotal || 0} phones`}>
                {(fraudData.duplicatePhones || []).length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No duplicate phones detected"
                    description="Every phone number is used by exactly one account"
                  />
                ) : (
                  <div className="p-4 space-y-1">
                    {(fraudData.duplicatePhones || []).map((dup: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-2 px-3 bg-muted/30 rounded">
                        <span className="font-mono">{dup.phone}</span>
                        <Badge variant="warning">{dup.count} accounts</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ContentCard>

              {/* High-value transactions */}
              <ContentCard
                title={`High-Value Transactions (₹1L+ in 7 days) — ${fraudData.highValueTxnTotal || 0} total`}
                action={null}
              >
                {(fraudData.highValueTransactions || []).length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No high-value transactions"
                    description="No ₹1L+ transactions in the last 7 days"
                  />
                ) : (
                  <table className="w-full">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">User</th>
                        <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Type</th>
                        <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Amount</th>
                        <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(fraudData.highValueTransactions || []).map((tx: any) => (
                        <tr key={tx.id} className="hover:bg-muted/30 transition">
                          <td className="px-4 py-3">
                            <Link href={`/users/${tx.userId}`} className="text-sm hover:underline">
                              {tx.userName || tx.userEmail || tx.userId.slice(0, 12)}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={tx.type === 'sale' ? 'success' : 'info'}>
                              {tx.type}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-amber-700 dark:text-amber-400">
                            {formatINR(tx.totalAmount)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                            {formatRelativeTime(tx.date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ContentCard>

              {(fraudData.highValueTxnTotal || 0) > 0 && (
                <Pagination
                  page={fraudPage}
                  totalPages={fraudData.highValueTxnTotalPages || 0}
                  total={fraudData.highValueTxnTotal || 0}
                  pageSize={PAGE_SIZE}
                  onPageChange={setFraudPage}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ============ SECURITY TAB ============ */}
      {tab === 'security' && (
        <>
          {securityLoading ? (
            <LoadingSkeleton rows={10} />
          ) : !securityData?.success ? (
            <EmptyState
              icon={Lock}
              title="Failed to load security data"
              description="Please try refreshing"
            />
          ) : (
            <>
              {/* Brute force IPs */}
              <ContentCard title={`Brute Force IPs (5+ fails in 24h) — ${securityData.bruteForceIpsTotal || 0} IPs`}>
                {(securityData.bruteForceIps || []).length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No brute force attempts detected"
                    description="No IPs with 5+ failed login attempts in the last 24 hours"
                  />
                ) : (
                  <div className="p-4 space-y-1">
                    {(securityData.bruteForceIps || []).map((ip: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-2 px-3 bg-red-50 dark:bg-red-950/20 rounded">
                        <span className="font-mono">{ip.ip}</span>
                        <Badge variant="danger">{ip.count} failed attempts</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ContentCard>

              {(securityData.bruteForceIpsTotal || 0) > 0 && (
                <Pagination
                  page={securityPage}
                  totalPages={securityData.bruteForceIpsTotalPages || 0}
                  total={securityData.bruteForceIpsTotal || 0}
                  pageSize={PAGE_SIZE}
                  onPageChange={setSecurityPage}
                />
              )}

              {/* Admin actions by type */}
              <ContentCard title="Admin Actions by Type (Last 30 Days)">
                {(securityData.adminActionsByType || []).length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No admin actions in last 30 days"
                    description="Admin activity will appear here once actions are performed"
                  />
                ) : (
                  <div className="p-4 space-y-2">
                    {(securityData.adminActionsByType || []).map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-2 px-3 bg-muted/30 rounded">
                        <span className="font-mono text-xs">{a.action}</span>
                        <Badge variant="neutral">{a.count} times</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ContentCard>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ===== READINESS ITEM (helper component) =====
function ReadinessItem({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm py-2 px-3 rounded-lg bg-muted/30">
      {enabled ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
      )}
      <span className={enabled ? 'text-foreground' : 'text-muted-foreground line-through'}>
        {label}
      </span>
      <span className={`ml-auto text-xs font-medium ${enabled ? 'text-emerald-600' : 'text-red-600'}`}>
        {enabled ? 'Ready' : 'Missing'}
      </span>
    </div>
  )
}
