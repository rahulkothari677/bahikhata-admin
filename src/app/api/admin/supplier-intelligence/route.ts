import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { generateReport, REPORT_CONFIGS } from '@/lib/supplier-intelligence'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/supplier-intelligence
 * Query: ?tab=overview|list&status=all|generated|delivered|archived
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'
    const status = url.searchParams.get('status') || 'all'

    if (tab === 'overview') {
      const [generatedCount, deliveredCount, totalRevenue, reportsByType] = await Promise.all([
        withTimeout(db.supplierReport.count({ where: { status: 'generated' } }), 5000).catch(() => 0),
        withTimeout(db.supplierReport.count({ where: { status: 'delivered' } }), 5000).catch(() => 0),
        withTimeout(db.supplierReport.aggregate({ _sum: { priceInr: true } }), 5000).catch(() => ({ _sum: { priceInr: 0 } })),
        withTimeout(
          db.supplierReport.groupBy({ by: ['type'], _count: true, _sum: { priceInr: true } }),
          5000
        ).catch(() => []),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          generatedCount,
          deliveredCount,
          totalRevenue: totalRevenue._sum.priceInr || 0,
          totalCount: generatedCount + deliveredCount,
        },
        reportTypes: REPORT_CONFIGS,
        reportsByType: (reportsByType as any[]).map((r: any) => ({
          type: r.type, count: r._count, revenue: r._sum.priceInr || 0,
        })),
      })
    }

    const where: any = {}
    if (status !== 'all') where.status = status

    // 🔒 V6 SC2: Add take cap to prevent loading the entire SupplierReport
    // table as it grows. Reports are append-only (one per generation), so at
    // scale this table grows unbounded. 500 is a sane upper bound for an
    // admin list view — if there are more, paginate via cursor.
    const reports = await withNeonRetry(() =>
      db.supplierReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
      })
    ).catch(() => [])

    return NextResponse.json({
      success: true,
      reports: (reports as any[]).map((r: any) => ({
        ...r,
        data: (() => { try { return JSON.parse(r.data) } catch { return {} } })(),
        createdAt: r.createdAt.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() || null,
        partnerName: null,
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 })
  }
}

/**
 * POST /api/admin/supplier-intelligence
 * Generate a new report.
 * Body: { type, name, partnerId?, priceInr?, period? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { type, name, partnerId, priceInr, period } = body

    if (!type || !name) return NextResponse.json({ error: 'type and name required' }, { status: 400 })

    const config = REPORT_CONFIGS.find(c => c.key === type)
    if (!config) return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })

    const result = await generateReport(type)

    const report = await db.supplierReport.create({
      data: {
        name: name.trim(),
        type,
        partnerId: partnerId || null,
        status: 'generated',
        summary: result.summary,
        data: JSON.stringify(result.data),
        dataPoints: result.dataPoints,
        userCount: result.userCount,
        priceInr: priceInr ?? config.suggestedPrice,
        period: period || new Date().toISOString().slice(0, 7),
        generatedBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'supplier_report_generate',
      description: `Generated ${type} report "${name}" (${result.dataPoints} data points, ${result.userCount} users)`,
      targetType: 'supplier_report',
      targetId: report.id,
    })

    return NextResponse.json({ success: true, report, summary: result.summary })
  } catch (error) {
    console.error('Report generation error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}
