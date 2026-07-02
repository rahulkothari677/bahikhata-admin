/**
 * GST Filing Service — prepares GST returns from transaction data.
 *
 * WHAT IT DOES:
 *   1. Aggregates all transactions with GST data (cgst, sgst, igst) for a given period
 *   2. Calculates total taxable value + total GST collected
 *   3. Splits into intra-state (CGST + SGST) and inter-state (IGST)
 *   4. Generates GSTR-1 format (outward supplies) summary
 *   5. Generates GSTR-3B format (monthly summary return) summary
 *
 * GST SLABS (India):
 *   0% (exempt), 5%, 12%, 18%, 28%
 *
 * FILING FREQUENCY:
 *   Monthly for turnover > ₹1.5 crore
 *   Quarterly for turnover < ₹1.5 crore (QRMP scheme)
 */

import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

export interface GstReport {
  period: string                    // YYYY-MM
  totalTaxableValue: number
  totalCgst: number
  totalSgst: number
  totalIgst: number
  totalGst: number
  intraStateCount: number           // transactions with CGST+SGST
  interStateCount: number           // transactions with IGST
  zeroGstCount: number              // transactions with no GST
  totalTransactions: number
  bySlab: Array<{
    slab: number                    // 0, 5, 12, 18, 28
    taxableValue: number
    cgst: number
    sgst: number
    igst: number
    count: number
  }>
  gstr1Summary: {
    outwardSupplies: number         // total taxable value
    totalTax: number                // total GST
    invoiceCount: number
  }
  gstr3bSummary: {
    outwardSupplies: number
    integratedTax: number           // IGST
    centralTax: number              // CGST
    stateTax: number                // SGST
    totalTaxLiability: number
  }
  eligibleUsers: number             // users with GST transactions
}

export async function generateGstReport(year: number, month: number): Promise<GstReport> {
  const periodStart = new Date(year, month, 1)
  const periodEnd = new Date(year, month + 1, 0, 23, 59, 59)
  const period = `${year}-${String(month + 1).padStart(2, '0')}`

  // Fetch transactions with GST data for this period
  const transactions = await withNeonRetry(() =>
    db.transaction.findMany({
      where: {
        createdAt: { gte: periodStart, lte: periodEnd },
        type: 'sale',
      },
      select: {
        id: true,
        totalAmount: true,
        cgst: true,
        sgst: true,
        igst: true,
        userId: true,
      },
      take: 50000,
    })
  ).catch(() => [])

  // Aggregate
  let totalTaxableValue = 0
  let totalCgst = 0
  let totalSgst = 0
  let totalIgst = 0
  let intraStateCount = 0
  let interStateCount = 0
  let zeroGstCount = 0

  const slabMap: Record<number, { taxableValue: number; cgst: number; sgst: number; igst: number; count: number }> = {}
  const userSet = new Set<string>()

  for (const t of transactions as any[]) {
    const taxableValue = t.totalAmount - (t.cgst || 0) - (t.sgst || 0) - (t.igst || 0)
    const cgst = t.cgst || 0
    const sgst = t.sgst || 0
    const igst = t.igst || 0
    const totalGstForTxn = cgst + sgst + igst

    totalTaxableValue += taxableValue
    totalCgst += cgst
    totalSgst += sgst
    totalIgst += igst

    if (cgst > 0 || sgst > 0) intraStateCount++
    else if (igst > 0) interStateCount++
    else zeroGstCount++

    // Determine slab (reverse calculate from GST rate)
    let slab = 0
    if (taxableValue > 0 && totalGstForTxn > 0) {
      const rate = (totalGstForTxn / taxableValue) * 100
      if (rate <= 1) slab = 0
      else if (rate <= 6) slab = 5
      else if (rate <= 13) slab = 12
      else if (rate <= 19) slab = 18
      else slab = 28
    }

    if (!slabMap[slab]) {
      slabMap[slab] = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, count: 0 }
    }
    slabMap[slab].taxableValue += taxableValue
    slabMap[slab].cgst += cgst
    slabMap[slab].sgst += sgst
    slabMap[slab].igst += igst
    slabMap[slab].count++

    userSet.add(t.userId)
  }

  const totalGst = totalCgst + totalSgst + totalIgst

  const bySlab = Object.entries(slabMap)
    .map(([slab, data]) => ({
      slab: parseInt(slab, 10),
      ...data,
      taxableValue: Math.round(data.taxableValue * 100) / 100,
      cgst: Math.round(data.cgst * 100) / 100,
      sgst: Math.round(data.sgst * 100) / 100,
      igst: Math.round(data.igst * 100) / 100,
    }))
    .sort((a, b) => a.slab - b.slab)

  return {
    period,
    totalTaxableValue: Math.round(totalTaxableValue * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100,
    intraStateCount,
    interStateCount,
    zeroGstCount,
    totalTransactions: transactions.length,
    bySlab,
    gstr1Summary: {
      outwardSupplies: Math.round(totalTaxableValue * 100) / 100,
      totalTax: Math.round(totalGst * 100) / 100,
      invoiceCount: transactions.length,
    },
    gstr3bSummary: {
      outwardSupplies: Math.round(totalTaxableValue * 100) / 100,
      integratedTax: Math.round(totalIgst * 100) / 100,
      centralTax: Math.round(totalCgst * 100) / 100,
      stateTax: Math.round(totalSgst * 100) / 100,
      totalTaxLiability: Math.round(totalGst * 100) / 100,
    },
    eligibleUsers: userSet.size,
  }
}

export async function getGstOverview() {
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const [thisMonthTxns, lastMonthTxns, totalGstUsers, totalGstCollected] = await Promise.all([
    withTimeout(
      db.transaction.aggregate({
        where: { createdAt: { gte: thisMonthStart }, type: 'sale' },
        _sum: { cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      5000
    ).catch(() => ({ _sum: { cgst: 0, sgst: 0, igst: 0 }, _count: 0 })),
    withTimeout(
      db.transaction.aggregate({
        where: { createdAt: { gte: lastMonthStart, lt: thisMonthStart }, type: 'sale' },
        _sum: { cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      5000
    ).catch(() => ({ _sum: { cgst: 0, sgst: 0, igst: 0 }, _count: 0 })),
    withTimeout(
      db.user.count({ where: { transactions: { some: { OR: [{ cgst: { gt: 0 } }, { sgst: { gt: 0 } }, { igst: { gt: 0 } }] } } } }),
      5000
    ).catch(() => 0),
    withTimeout(
      db.transaction.aggregate({
        where: { type: 'sale' },
        _sum: { cgst: true, sgst: true, igst: true },
      }),
      5000
    ).catch(() => ({ _sum: { cgst: 0, sgst: 0, igst: 0 } })),
  ])

  const thisMonthGst = (thisMonthTxns._sum.cgst || 0) + (thisMonthTxns._sum.sgst || 0) + (thisMonthTxns._sum.igst || 0)
  const lastMonthGst = (lastMonthTxns._sum.cgst || 0) + (lastMonthTxns._sum.sgst || 0) + (lastMonthTxns._sum.igst || 0)
  const totalGst = (totalGstCollected._sum.cgst || 0) + (totalGstCollected._sum.sgst || 0) + (totalGstCollected._sum.igst || 0)

  return {
    thisMonthGst: Math.round(thisMonthGst * 100) / 100,
    thisMonthTxnCount: thisMonthTxns._count,
    lastMonthGst: Math.round(lastMonthGst * 100) / 100,
    lastMonthTxnCount: lastMonthTxns._count,
    totalGstUsers,
    totalGstCollected: Math.round(totalGst * 100) / 100,
  }
}
