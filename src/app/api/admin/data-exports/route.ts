import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

const VALID_TYPES = ['user_data', 'all_users', 'transactions', 'subscriptions', 'ai_usage', 'custom']

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'
    const status = url.searchParams.get('status') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    if (tab === 'overview') {
      const [pendingCount, completedCount, failedCount, totalExports, totalRows] = await Promise.all([
        withTimeout(db.dataExportRequest.count({ where: { status: 'pending' } }), 5000).catch(() => 0),
        withTimeout(db.dataExportRequest.count({ where: { status: 'completed' } }), 5000).catch(() => 0),
        withTimeout(db.dataExportRequest.count({ where: { status: 'failed' } }), 5000).catch(() => 0),
        withTimeout(db.dataExportRequest.count(), 5000).catch(() => 0),
        withTimeout(db.dataExportRequest.aggregate({ _sum: { rowCount: true } }), 5000).catch(() => ({ _sum: { rowCount: 0 } })),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          pendingCount,
          completedCount,
          failedCount,
          totalExports,
          totalRows: totalRows._sum.rowCount || 0,
        },
      })
    }

    const skip = (page - 1) * pageSize
    const where: any = {}
    if (status !== 'all') where.status = status

    const [exports, total] = await Promise.all([
      withNeonRetry(() =>
        db.dataExportRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize })
      ).catch(() => []),
      withTimeout(db.dataExportRequest.count({ where }), 5000).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      exports: (exports as any[]).map((e: any) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        completedAt: e.completedAt?.toISOString() || null,
        expiresAt: e.expiresAt?.toISOString() || null,
      })),
      page, pageSize, total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch exports' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { type, format, userId, customQuery } = body

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid export type' }, { status: 400 })
    }
    if (type === 'user_data' && !userId) {
      return NextResponse.json({ error: 'userId required for user_data export' }, { status: 400 })
    }
    if (type === 'custom' && !customQuery) {
      return NextResponse.json({ error: 'customQuery required for custom export' }, { status: 400 })
    }

    const exportReq = await db.dataExportRequest.create({
      data: {
        type,
        format: format || 'csv',
        userId: userId || null,
        customQuery: customQuery || null,
        status: 'pending',
        requestedBy: (session.user as any).id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'data_export_request',
      description: `Requested ${type} export (${format || 'csv'})`,
      targetType: 'data_export',
      targetId: exportReq.id,
    })

    return NextResponse.json({ success: true, export: exportReq })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create export' }, { status: 500 })
  }
}
