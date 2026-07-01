'use client'

import { useQuery } from '@tanstack/react-query'
import { Shield, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, Lock, Database, Activity, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

export default function RiskPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-risk'],
    queryFn: async () => {
      const r = await fetch('/api/admin/risk')
      return r.json()
    },
    refetchInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Scanning for risks...</span>
      </div>
    )
  }

  if (!data?.success) return <div className="p-6 text-muted-foreground">Failed to load risk data</div>

  const { fraud, dpdp, security, breachReadiness } = data

  const riskIcon = fraud.riskScore.level === 'critical' ? ShieldX :
                    fraud.riskScore.level === 'high' ? ShieldAlert :
                    fraud.riskScore.level === 'medium' ? Shield :
                    ShieldCheck

  const riskColor = fraud.riskScore.level === 'critical' ? 'text-red-600 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900' :
                     fraud.riskScore.level === 'high' ? 'text-orange-600 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900' :
                     fraud.riskScore.level === 'medium' ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900' :
                     'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'

  const RiskIcon = riskIcon

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-slate-700" />
          Risk & Compliance
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fraud detection, DPDP compliance, security monitoring, and breach readiness
        </p>
      </div>

      {/* Overall Risk Score */}
      <div className={`rounded-xl border p-4 ${riskColor}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide opacity-70">Overall Risk Level</p>
            <p className="text-3xl font-bold mt-1 capitalize">{fraud.riskScore.level}</p>
            <p className="text-xs opacity-70 mt-1">Risk score: {fraud.riskScore.score}/100</p>
          </div>
          <RiskIcon className="w-12 h-12 opacity-80" />
        </div>
      </div>

      {/* Fraud Detection */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Fraud Detection
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[10px] text-muted-foreground uppercase">Duplicate Phones</p>
            <p className="text-xl font-bold mt-1">{fraud.duplicatePhones.length}</p>
            <p className="text-[10px] text-muted-foreground">same phone, multiple accounts</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[10px] text-muted-foreground uppercase">Bot Patterns Detected</p>
            <p className="text-xl font-bold mt-1">{fraud.suspiciousSignupDays.length}</p>
            <p className="text-[10px] text-muted-foreground">sequential emails, domain bursts</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[10px] text-muted-foreground uppercase">Inactive New Users</p>
            <p className="text-xl font-bold mt-1">{fraud.inactiveNewUsers}</p>
            <p className="text-[10px] text-muted-foreground">no activity after 7 days</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[10px] text-muted-foreground uppercase">High-Value Transactions</p>
            <p className="text-xl font-bold mt-1">{fraud.highValueTransactions.length}</p>
            <p className="text-[10px] text-muted-foreground">₹1L+ in last 7 days</p>
          </div>
        </div>

        {/* Duplicate phones detail */}
        {fraud.duplicatePhones.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Duplicate Phone Numbers</p>
            <div className="space-y-1">
              {fraud.duplicatePhones.slice(0, 5).map((dup: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-muted/30 rounded">
                  <span className="font-mono">{dup.phone}</span>
                  <span className="text-amber-600 font-medium">{dup.count} accounts</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* High-value transactions */}
        {fraud.highValueTransactions.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase mb-2">High-Value Transactions (₹1L+)</p>
            <div className="space-y-1">
              {fraud.highValueTransactions.slice(0, 5).map((tx: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-muted/30 rounded">
                  <span className="capitalize">{tx.type}</span>
                  <span className="font-bold text-amber-600">{formatINR(tx.totalAmount)}</span>
                  <span className="text-muted-foreground">{formatRelativeTime(tx.date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {fraud.duplicatePhones.length === 0 && fraud.highValueTransactions.length === 0 && (
          <p className="text-xs text-muted-foreground mt-2">✅ No fraud patterns detected</p>
        )}
      </div>

      {/* DPDP Compliance + Security — 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* DPDP Compliance */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-500" />
            DPDP Act Compliance
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Users with data (need consent)</span>
              <span className="font-bold">{formatNumber(dpdp.usersWithData)}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Data export requests</span>
              <span className="font-bold">{dpdp.dataExportRequests}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Data deletion requests</span>
              <span className="font-bold">{dpdp.dataDeleteRequests}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Recent requests (30 days)</span>
              <span className="font-bold">{dpdp.recentDataRequests}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm font-medium">Compliance Score</span>
              <span className={`font-bold text-lg ${dpdp.complianceScore >= 80 ? 'text-emerald-600' : dpdp.complianceScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                {dpdp.complianceScore}/100
              </span>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            <p>📋 DPDP Act 2025 requires:</p>
            <p>✓ Explicit consent for data collection</p>
            <p>✓ Right to access, correct, delete data</p>
            <p>✓ 72-hour breach notification</p>
            <p>✓ Data processing audit trail</p>
            <p>⚠️ Need to implement: consent collection UI in main app</p>
          </div>
        </div>

        {/* Security Overview */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-500" />
            Security Overview (24h)
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Successful logins</span>
              <span className="font-bold text-emerald-600">{security.successfulLogins24h}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Failed login attempts</span>
              <span className="font-bold text-red-600">{security.failedLogins24h}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Login success rate</span>
              <span className={`font-bold ${security.loginSuccessRate >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {security.loginSuccessRate}%
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm">Brute force IPs (5+ fails)</span>
              <span className={`font-bold ${security.bruteForceIps.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {security.bruteForceIps.length}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm">Admin actions (30 days)</span>
              <span className="font-bold">{security.adminActions30Days}</span>
            </div>
          </div>

          {/* Brute force IPs */}
          {security.bruteForceIps.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-red-600 uppercase mb-2">⚠️ Brute Force Attempts</p>
              <div className="space-y-1">
                {security.bruteForceIps.map((ip: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-red-50 dark:bg-red-950/20 rounded">
                    <span className="font-mono">{ip.ip}</span>
                    <span className="text-red-600 font-medium">{ip.count} fails</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Breach Readiness Checklist */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-500" />
          Data Breach Readiness Checklist
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ReadinessItem label="Encryption at rest" enabled={breachReadiness.encryptionAtRest} />
          <ReadinessItem label="Encryption in transit (HTTPS)" enabled={breachReadiness.encryptionInTransit} />
          <ReadinessItem label="Audit log enabled" enabled={breachReadiness.auditLogEnabled} />
          <ReadinessItem label="Rate limiting enabled" enabled={breachReadiness.rateLimitingEnabled} />
          <ReadinessItem label="CSRF protection" enabled={breachReadiness.csrfProtection} />
          <ReadinessItem label="2FA available" enabled={breachReadiness.twoFactorAvailable} />
          <ReadinessItem label="IP allowlist configured" enabled={breachReadiness.ipAllowlistConfigured} />
          <ReadinessItem label="Backup verification" enabled={false} />
        </div>

        {/* Breach response playbook */}
        <div className="mt-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900 p-3">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-2">
            🚨 Data Breach Response Playbook (DPDP Act: 72-hour reporting)
          </p>
          <ol className="text-xs text-amber-700 dark:text-amber-300 space-y-1 ml-4 list-decimal">
            <li>Detect: Sentry alert or user report triggers investigation</li>
            <li>Assess: Determine scope — which users, what data, how accessed</li>
            <li>Contain: Block the attack vector (revoke tokens, block IPs, rotate secrets)</li>
            <li>Notify: Email affected users within 72 hours (template in /scripts)</li>
            <li>Report: File report with Data Protection Board of India</li>
            <li>Document: Log everything in AuditLog for forensics</li>
            <li>Remediate: Fix the vulnerability that caused the breach</li>
            <li>Review: Post-mortem analysis to prevent recurrence</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

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
