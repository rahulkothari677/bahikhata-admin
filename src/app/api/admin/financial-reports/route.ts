import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getProfitLoss, getBalanceSheet, getCashFlow } from '@/lib/financial-reports'

/**
 * GET /api/admin/financial-reports
 *
 * Returns investor-grade financial statements.
 *
 * Query params:
 *   - statement: 'pnl' | 'balance_sheet' | 'cash_flow' (required)
 *   - year: number (required, e.g. 2026)
 *   - month: number (optional, 0-11 — if omitted, returns yearly report)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const statement = url.searchParams.get('statement') || 'pnl'
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10)
    const monthParam = url.searchParams.get('month')
    const month = monthParam !== null ? parseInt(monthParam, 10) : undefined

    if (month !== undefined && (month < 0 || month > 11)) {
      return NextResponse.json({ error: 'Month must be 0-11' }, { status: 400 })
    }

    if (statement === 'pnl') {
      const report = await getProfitLoss(year, month)
      return NextResponse.json({ success: true, report })
    }

    if (statement === 'balance_sheet') {
      const report = await getBalanceSheet()
      return NextResponse.json({ success: true, report })
    }

    if (statement === 'cash_flow') {
      const report = await getCashFlow(year, month)
      return NextResponse.json({ success: true, report })
    }

    return NextResponse.json({ error: 'Invalid statement type' }, { status: 400 })
  } catch (error) {
    console.error('Financial reports error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to generate report',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
