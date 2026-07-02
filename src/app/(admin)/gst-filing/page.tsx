'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  FileText, TrendingUp, Wallet, Users, Calendar,
  AlertCircle, Download, BarChart3,
} from 'lucide-react'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatINR, formatNumber } from '@/lib/utils'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SLAB_LABELS: Record<number, string> = { 0: '0% (Exempt)', 5: '5%', 12: '12%', 18: '18%', 28: '28%' }

export default function GstFilingPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [month, setMonth] = useState(new Date().getMonth())

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-gst-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/gst-filing?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: reportData, isLoading: reportLoading } = useQuery({
    queryKey: ['admin-gst-report', year, month],
    queryFn: async () => {
      const r = await fetch(`/api/admin/gst-filing?tab=report&year=${year}&month=${month}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const ov = overview?.overview || {}
  const report = reportData?.report

  const handleDownload = () => {
    if (!report) return
    // Generate CSV from report
    let csv = 'GST Filing Report\n'
    csv += `Period,${report.period}\n\n`
    csv += 'Summary\n'
    csv += `Total Taxable Value,${report.totalTaxableValue}\n`
    csv += `Total CGST,${report.totalCgst}\n`
    csv += `Total SGST,${report.totalSgst}\n`
    csv += `Total IGST,${report.totalIgst}\n`
    csv += `Total GST,${report.totalGst}\n\n`
    csv += 'By Slab\n'
    csv += 'Slab,Taxable Value,CGST,SGST,IGST,Count\n'
    for (const s of report.bySlab) {
      csv += `${s.slab}%,${s.taxableValue},${s.cgst},${s.sgst},${s.igst},${s.count}\n`
    }
    csv += '\nGSTR-3B Summary\n'
    csv += `Outward Supplies,${report.gstr3bSummary.outwardSupplies}\n`
    csv += `Integrated Tax (IGST),${report.gstr3bSummary.integratedTax}\n`
    csv += `Central Tax (CGST),${report.gstr3bSummary.centralTax}\n`
    csv += `State Tax (SGST),${report.gstr3bSummary.stateTax}\n`
    csv += `Total Tax Liability,${report.gstr3bSummary.totalTaxLiability}\n`

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gst_report_${report.period}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="GST Filing Service"
        description="Prepare GST returns from transaction data · CGST/SGST/IGST calculation · GSTR-1 + GSTR-3B format"
      />

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
          <KPICard label="GST This Month" value={formatINR(ov.thisMonthGst || 0)} icon={Wallet} iconColor="text-emerald-600" sublabel={`${ov.thisMonthTxnCount || 0} transactions`} />
          <KPICard label="GST Last Month" value={formatINR(ov.lastMonthGst || 0)} icon={TrendingUp} iconColor="text-blue-600" sublabel={`${ov.lastMonthTxnCount || 0} transactions`} />
          <KPICard label="Total GST Collected" value={formatINR(ov.totalGstCollected || 0)} icon={BarChart3} iconColor="text-violet-600" sublabel="All time" />
          <KPICard label="Users with GST Data" value={formatNumber(ov.totalGstUsers || 0)} icon={Users} iconColor="text-amber-600" sublabel="Have GST transactions" />
        </KPIGrid>
      ) : null}

      {/* Period selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Report Period:</span>
        </div>
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex items-center gap-1">
          {MONTHS.map((m, i) => (
            <button
              key={m}
              onClick={() => setMonth(i)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition ${month === i ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
            >
              {m}
            </button>
          ))}
        </div>
        {report && (
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 ml-auto"
          >
            <Download className="w-3 h-3" />
            Download CSV
          </button>
        )}
      </div>

      {/* Report */}
      {reportLoading ? (
        <LoadingSkeleton rows={10} />
      ) : !reportData?.success || !report ? (
        <EmptyState icon={AlertCircle} title="Failed to generate report" description="Try a different period" />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase">Taxable Value</p>
              <p className="text-xl font-bold mt-1">{formatINR(report.totalTaxableValue)}</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase">CGST + SGST (Intra-state)</p>
              <p className="text-xl font-bold mt-1 text-blue-600">{formatINR(report.totalCgst + report.totalSgst)}</p>
              <p className="text-[10px] text-muted-foreground">{report.intraStateCount} transactions</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase">IGST (Inter-state)</p>
              <p className="text-xl font-bold mt-1 text-violet-600">{formatINR(report.totalIgst)}</p>
              <p className="text-[10px] text-muted-foreground">{report.interStateCount} transactions</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase">Total GST</p>
              <p className="text-xl font-bold mt-1 text-emerald-600">{formatINR(report.totalGst)}</p>
              <p className="text-[10px] text-muted-foreground">{report.totalTransactions} invoices</p>
            </div>
          </div>

          {/* By Slab */}
          <ContentCard title="GST Breakdown by Tax Slab">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-2">Slab</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">Taxable Value</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">CGST</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">SGST</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">IGST</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-2">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.bySlab.map((s: any) => (
                  <tr key={s.slab} className="hover:bg-muted/30">
                    <td className="px-4 py-2"><Badge variant={s.slab >= 18 ? 'warning' : s.slab > 0 ? 'info' : 'neutral'}>{SLAB_LABELS[s.slab] || `${s.slab}%`}</Badge></td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">{formatINR(s.taxableValue)}</td>
                    <td className="px-4 py-2 text-right text-sm text-blue-600 tabular-nums">{formatINR(s.cgst)}</td>
                    <td className="px-4 py-2 text-right text-sm text-blue-600 tabular-nums">{formatINR(s.sgst)}</td>
                    <td className="px-4 py-2 text-right text-sm text-violet-600 tabular-nums">{formatINR(s.igst)}</td>
                    <td className="px-4 py-2 text-right text-sm text-muted-foreground">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ContentCard>

          {/* GSTR-3B Summary */}
          <ContentCard title="GSTR-3B Summary (Monthly Return)">
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-sm">Outward Taxable Supplies</span>
                  <span className="text-sm font-medium tabular-nums">{formatINR(report.gstr3bSummary.outwardSupplies)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-sm">Integrated Tax (IGST)</span>
                  <span className="text-sm font-medium text-violet-600 tabular-nums">{formatINR(report.gstr3bSummary.integratedTax)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-sm">Central Tax (CGST)</span>
                  <span className="text-sm font-medium text-blue-600 tabular-nums">{formatINR(report.gstr3bSummary.centralTax)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-sm">State Tax (SGST)</span>
                  <span className="text-sm font-medium text-blue-600 tabular-nums">{formatINR(report.gstr3bSummary.stateTax)}</span>
                </div>
                <div className="flex justify-between py-2 font-bold">
                  <span className="text-sm">Total Tax Liability</span>
                  <span className="text-sm text-emerald-600 tabular-nums">{formatINR(report.gstr3bSummary.totalTaxLiability)}</span>
                </div>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-2">
                  <FileText className="w-4 h-4 inline mr-1" />
                  GSTR-3B is the monthly summary return. File on the GST portal by the 20th of the following month.
                </p>
                <p className="text-xs text-muted-foreground">
                  Eligible users: <strong>{report.eligibleUsers}</strong> users have GST transactions for this period.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Total invoices: <strong>{report.totalTransactions}</strong>
                </p>
              </div>
            </div>
          </ContentCard>

          {/* How it works */}
          <div className="bg-muted/30 rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              How GST filing works (investor-readable)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="font-medium text-foreground mb-1">GST Calculation:</p>
                <ul className="space-y-0.5">
                  <li>• Reads transaction data (cgst, sgst, igst fields) for the selected period</li>
                  <li>• Aggregates total taxable value + total GST collected</li>
                  <li>• Splits into intra-state (CGST+SGST) and inter-state (IGST)</li>
                  <li>• Groups by tax slab (0%, 5%, 12%, 18%, 28%)</li>
                  <li>• Generates GSTR-1 (outward supplies) and GSTR-3B (monthly summary)</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Revenue Opportunity:</p>
                <ul className="space-y-0.5">
                  <li>• Charge users ₹500-₹2,000 per filing (based on complexity)</li>
                  <li>• Monthly filing for turnover &gt; ₹1.5 crore</li>
                  <li>• Quarterly (QRMP) for turnover &lt; ₹1.5 crore</li>
                  <li>• {report.eligibleUsers} eligible users × ₹1,000/filing = {formatINR(report.eligibleUsers * 1000)}/month potential</li>
                  <li>• Download CSV → upload to GST portal</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
