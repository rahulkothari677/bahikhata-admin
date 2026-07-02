'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Landmark, Plus, X, Loader2, TrendingUp, Wallet,
  CheckCircle2, Clock, AlertCircle, Building2, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  SearchBar, LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

export default function AccountAggregatorPage() {
  const queryClient = useQueryClient()
  const [searchUserId, setSearchUserId] = useState('')
  const [showRequestModal, setShowRequestModal] = useState(false)

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-aa-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/account-aggregator?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ['admin-aa-data', searchUserId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/account-aggregator?tab=data&userId=${searchUserId}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: !!searchUserId,
    staleTime: 30 * 1000,
  })

  const requestMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch('/api/admin/account-aggregator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`)
      return result
    },
    onSuccess: (data) => {
      toast.success('Consent requested', { description: data.message })
      queryClient.invalidateQueries({ queryKey: ['admin-aa-overview'] })
      setShowRequestModal(false)
    },
    onError: (err: Error) => toast.error('Request failed', { description: err.message }),
  })

  const ov = overview?.overview || {}
  const supportedBanks = overview?.supportedBanks || []
  const simulationMode = overview?.simulationMode
  const financialData = userData?.data

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Account Aggregator"
        description="India's AA framework · bank data access with user consent · RBI-regulated"
        actions={
          <button
            onClick={() => setShowRequestModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Request Consent
          </button>
        }
      />

      {/* Simulation mode banner */}
      {simulationMode !== undefined && (
        <div className={`rounded-xl border p-3 flex items-center gap-3 ${
          simulationMode
            ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
            : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
        }`}>
          {simulationMode ? (
            <>
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                <strong>Simulation Mode</strong> — No AA provider configured. Mock bank data is generated for testing.
                To enable production: set <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">AA_BASE_URL</code>, <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">AA_CLIENT_ID</code>, <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">AA_CLIENT_SECRET</code> env vars.
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                <strong>Production Mode</strong> — AA provider connected. Real bank data will be fetched with user consent.
              </p>
            </>
          )}
        </div>
      )}

      {/* Overview KPIs */}
      {overviewLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
              <div className="h-3 bg-muted rounded w-1/2 mb-2" />
              <div className="h-6 bg-muted rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : overview?.success ? (
        <KPIGrid>
          <KPICard label="Consent Requests" value={formatNumber(ov.totalRequests || 0)} icon={Landmark} iconColor="text-violet-600" sublabel="Total initiated" />
          <KPICard label="Data Received" value={formatNumber(ov.dataReceivedCount || 0)} icon={CheckCircle2} iconColor="text-emerald-600" sublabel="Bank data fetched" />
          <KPICard label="Users with Consent" value={formatNumber(ov.uniqueUsersWithConsent || 0)} icon={Wallet} iconColor="text-blue-600" sublabel="Gave bank access" />
          <KPICard label="Supported Banks" value={String(supportedBanks.length)} icon={Building2} iconColor="text-amber-600" sublabel="FIP partners" />
        </KPIGrid>
      ) : null}

      {/* Supported banks */}
      <ContentCard title="Supported Banks (Financial Information Providers)">
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {supportedBanks.map((bank: any) => (
            <div key={bank.fipId} className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg border border-border">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{bank.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{bank.fipId}</p>
              </div>
            </div>
          ))}
        </div>
      </ContentCard>

      {/* Search user financial data */}
      <ContentCard title="Search User Financial Data">
        <div className="p-4 space-y-3">
          <SearchBar
            value={searchUserId}
            onChange={setSearchUserId}
            placeholder="Enter user ID to view their bank data..."
          />

          {userLoading ? (
            <LoadingSkeleton rows={4} />
          ) : !searchUserId ? (
            <EmptyState icon={Search} title="Enter a user ID" description="Search for a user to view their AA financial data" />
          ) : !financialData ? (
            <EmptyState icon={AlertCircle} title="No AA data for this user" description="Request consent first to fetch bank data" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="success">Data Received</Badge>
                <Badge variant="neutral">{financialData.bankName || 'Unknown bank'}</Badge>
                <span className="text-xs text-muted-foreground">Account: {financialData.accountNumber}</span>
                <span className="text-xs text-muted-foreground">· Received {formatRelativeTime(financialData.dataReceivedAt)}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground uppercase">Est. Monthly Income</p>
                  <p className="text-lg font-bold text-emerald-600">{formatINR(financialData.estimatedMonthlyIncome || 0)}</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground uppercase">Avg Monthly Balance</p>
                  <p className="text-lg font-bold">{formatINR(financialData.avgMonthlyBalance || 0)}</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground uppercase">Total Credits (3mo)</p>
                  <p className="text-lg font-bold text-emerald-600">{formatINR(financialData.totalCredits || 0)}</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground uppercase">Total Debits (3mo)</p>
                  <p className="text-lg font-bold text-red-600">{formatINR(financialData.totalDebits || 0)}</p>
                </div>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Transactions in period: <strong>{financialData.transactionCount || 0}</strong></p>
                <p className="text-xs text-muted-foreground">Consent ID: <code className="font-mono">{financialData.consentId}</code></p>
              </div>
            </div>
          )}
        </div>
      </ContentCard>

      {/* How it works */}
      <div className="bg-muted/30 rounded-xl border border-border p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          How Account Aggregator works (investor-readable)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-1">Consent Flow:</p>
            <ul className="space-y-0.5">
              <li>1. Admin requests consent for a user (selects banks)</li>
              <li>2. User approves via AA app (OneMoney, FinVu, etc.)</li>
              <li>3. AA notifies us via webhook</li>
              <li>4. We request financial data from AA</li>
              <li>5. AA fetches from banks (Financial Information Providers)</li>
              <li>6. AA returns aggregated data (income, balances, transactions)</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">Use Cases + Revenue:</p>
            <ul className="space-y-0.5">
              <li>• <strong>Credit scoring</strong>: verify income from bank statements</li>
              <li>• <strong>Lending</strong>: NBFC partners can verify user financials</li>
              <li>• <strong>GST verification</strong>: cross-check bank deposits with GST</li>
              <li>• RBI-regulated: data encrypted, consent-based, revocable</li>
              <li>• 8 supported banks (HDFC, ICICI, SBI, Axis, Kotak, Yes, PNB, BoB)</li>
              <li>• Charge NBFCs ₹50-100 per verified financial report</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Request consent modal */}
      {showRequestModal && (
        <ConsentModal
          onClose={() => setShowRequestModal(false)}
          onRequest={(data) => requestMutation.mutate(data)}
          saving={requestMutation.isPending}
          simulationMode={simulationMode}
        />
      )}
    </div>
  )
}

function ConsentModal({ onClose, onRequest, saving, simulationMode }: { onClose: () => void; onRequest: (data: any) => void; saving: boolean; simulationMode?: boolean }) {
  const [userId, setUserId] = useState('')
  const [purpose, setPurpose] = useState('Credit assessment for lending')

  const handleRequest = () => {
    if (!userId.trim()) { toast.error('User ID is required'); return }
    onRequest({ userId, purpose })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-md z-[101]" style={{ backgroundColor: '#ffffff', color: '#0f172a' }}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>Request Bank Data Consent</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">User ID *</label>
            <input type="text" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="cmd..." className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary" />
            <p className="text-[10px] text-muted-foreground mt-0.5">Get from Users page</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Purpose</label>
            <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          {simulationMode && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                🔔 Simulation mode: consent will be auto-approved and mock bank data will be generated immediately.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80">Cancel</button>
          <button onClick={handleRequest} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />}
            Request Consent
          </button>
        </div>
      </div>
    </div>
  )
}
