'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Banknote, Send, Loader2, TrendingUp, Wallet, Users,
  CheckCircle2, Clock, AlertCircle, Zap,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

type Tab = 'overview' | 'leads'

const BAND_CONFIG: Record<string, { color: string; badge: 'success' | 'info' | 'warning' | 'danger'; revenue: number }> = {
  excellent: { color: 'text-emerald-600', badge: 'success', revenue: 200 },
  good: { color: 'text-blue-600', badge: 'info', revenue: 150 },
  fair: { color: 'text-amber-600', badge: 'warning', revenue: 100 },
  poor: { color: 'text-red-600', badge: 'danger', revenue: 0 },
}

const DELIVERY_STATUS_BADGE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  success: 'success',
  failed: 'danger',
  retrying: 'warning',
  pending: 'neutral',
}

export default function LendingPipelinePage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')

  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-lending-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/lending-pipeline?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['admin-lending-leads'],
    queryFn: async () => {
      const r = await fetch('/api/admin/lending-pipeline?tab=leads')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'leads',
    staleTime: 30 * 1000,
  })

  const deliverMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/lending-pipeline/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minScore: 550, maxLeads: 100 }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Delivered ${data.eligibleLeads} leads to ${data.delivered} endpoints`,
        { description: `Revenue: ${formatINR(data.revenue)} · Duration: ${(data.durationMs / 1000).toFixed(1)}s` }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-lending-overview'] })
    },
    onError: (err: Error) => toast.error('Delivery failed', { description: err.message }),
  })

  const ov = overviewData?.overview || {}
  const recentDeliveries = overviewData?.recentDeliveries || []
  const leads = leadsData?.leads || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Lending Pipeline"
        description="Deliver credit-scored leads to NBFC partners via webhooks · ₹200/₹150/₹100 per lead by band"
        actions={
          <button
            onClick={() => deliverMutation.mutate()}
            disabled={deliverMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50"
          >
            {deliverMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Deliver Leads Now
          </button>
        }
      />

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'leads' as const, label: 'Top Leads', icon: Banknote },
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
              <LoadingSkeleton rows={6} />
            </>
          ) : !overviewData?.success ? (
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Eligible Leads"
                  value={formatNumber(ov.eligibleCount || 0)}
                  icon={Users}
                  iconColor="text-violet-600"
                  sublabel="Score ≥ 550 (fair+)"
                />
                <KPICard
                  label="Potential Revenue"
                  value={formatINR(ov.potentialRevenue || 0)}
                  icon={Wallet}
                  iconColor="text-emerald-600"
                  sublabel="If all leads delivered"
                />
                <KPICard
                  label="Delivered (all time)"
                  value={formatNumber(ov.totalDelivered || 0)}
                  icon={CheckCircle2}
                  iconColor="text-blue-600"
                  sublabel="Successful deliveries"
                />
                <KPICard
                  label="Active NBFC Partners"
                  value={formatNumber(ov.activeNbfcPartners || 0)}
                  icon={Banknote}
                  iconColor="text-amber-600"
                  sublabel="Ready to receive leads"
                />
              </KPIGrid>

              {/* Lead distribution by band */}
              <ContentCard title="Lead Distribution by Credit Band">
                <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                  {(['excellent', 'good', 'fair', 'poor'] as const).map(band => {
                    const cfg = BAND_CONFIG[band]
                    const count = (ov as any)[`${band}Count`] || 0
                    const revenue = count * cfg.revenue
                    return (
                      <div key={band} className="p-3 bg-muted/30 rounded-lg border border-border">
                        <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
                        <p className="text-xs font-medium capitalize">{band}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {band !== 'poor' ? `${formatINR(cfg.revenue)}/lead = ${formatINR(revenue)}` : 'Not eligible'}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </ContentCard>

              {/* Recent deliveries */}
              <ContentCard title="Recent Lead Deliveries">
                {recentDeliveries.length === 0 ? (
                  <EmptyState icon={Send} title="No deliveries yet" description="Click 'Deliver Leads Now' to send leads to NBFC partners" />
                ) : (
                  <div className="p-4 space-y-2">
                    {recentDeliveries.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                        <div>
                          <p className="text-sm font-medium">{d.partnerName}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate max-w-xs">{d.endpointUrl}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {d.responseStatus && <span className="text-xs font-mono">HTTP {d.responseStatus}</span>}
                          <Badge variant={DELIVERY_STATUS_BADGE[d.status] || 'neutral'}>{d.status}</Badge>
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(d.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ContentCard>

              {/* How it works */}
              <div className="bg-muted/30 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  How the lending pipeline works (investor-readable)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Process:</p>
                    <ul className="space-y-0.5">
                      <li>1. Credit scores computed (Data Monetization page → Recompute)</li>
                      <li>2. Eligible leads: score ≥ 550 (fair, good, excellent bands)</li>
                      <li>3. Admin clicks "Deliver Leads Now"</li>
                      <li>4. System dispatches 'lead.created' webhook event</li>
                      <li>5. Webhook engine sends to all NBFC partners subscribed</li>
                      <li>6. Partner receives lead data, decides to lend or reject</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Revenue Model:</p>
                    <ul className="space-y-0.5">
                      <li>• Excellent (750+): <strong>₹200 per lead</strong></li>
                      <li>• Good (650-749): <strong>₹150 per lead</strong></li>
                      <li>• Fair (550-649): <strong>₹100 per lead</strong></li>
                      <li>• Poor (&lt;550): <strong>not delivered</strong> (not eligible)</li>
                      <li>• Max 100 leads per delivery (synchronous)</li>
                      <li>• 5-minute cooldown between deliveries</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* LEADS TAB */}
      {tab === 'leads' && (
        <ContentCard title={`Top Lending Candidates — ${leads.length} eligible (score ≥ 550)`}>
          {leadsLoading ? (
            <LoadingSkeleton rows={10} />
          ) : leads.length === 0 ? (
            <EmptyState icon={Banknote} title="No eligible leads" description="Compute credit scores first on the Data Monetization page" />
          ) : (
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">#</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">User</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Score</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Band</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Monthly Sales</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Recommended Loan</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Revenue/Lead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l: any, i: number) => {
                  const cfg = BAND_CONFIG[l.band] || BAND_CONFIG.fair
                  return (
                    <tr key={l.id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-3 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3">
                        <Link href={`/users/${l.userId}`} className="text-sm hover:underline">
                          {l.userId.slice(0, 12)}…
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-lg font-bold ${cfg.color}`}>{l.score}</span>
                        <span className="text-[10px] text-muted-foreground">/900</span>
                      </td>
                      <td className="px-4 py-3"><Badge variant={cfg.badge}>{l.band}</Badge></td>
                      <td className="px-4 py-3 text-right text-sm font-medium">{formatINR(Math.round(l.avgMonthlySales))}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-emerald-600">{formatINR(l.recommendedLoanAmount)}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-violet-600">{formatINR(l.revenuePerLead)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-muted/30 border-t-2 border-border">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-sm font-bold text-right">Total Potential Revenue:</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right text-lg font-bold text-violet-600">
                    {formatINR(leads.reduce((sum: number, l: any) => sum + l.revenuePerLead, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </ContentCard>
      )}
    </div>
  )
}
