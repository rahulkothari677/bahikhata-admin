import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/audit-log
 *
 * Returns admin actions with server-side search + filters + pagination.
 * Scales to millions of audit entries.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'list')
 *   - search: string (search by description, admin email, action type)
 *   - action: 'all' | specific action type
 *   - targetType: 'all' | specific target type
 *   - adminId: 'all' | specific admin ID
 *   - dateFrom: ISO string (optional)
 *   - dateTo: ISO string (optional)
 *   - page: number (default 1)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'
    const search = url.searchParams.get('search') || ''
    const actionFilter = url.searchParams.get('action') || 'all'
    const targetTypeFilter = url.searchParams.get('targetType') || 'all'
    const adminIdFilter = url.searchParams.get('adminId') || 'all'
    const dateFrom = url.searchParams.get('dateFrom')
    const dateTo = url.searchParams.get('dateTo')
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const now = new Date()
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000)
      const monthStart = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000)

      const [todayCount, weekCount, monthCount, totalCount, topActions, topTargetTypes] = await Promise.all([
        withTimeout(db.adminAction.count({ where: { createdAt: { gte: todayStart } } }), 5000).catch(() => 0),
        withTimeout(db.adminAction.count({ where: { createdAt: { gte: weekStart } } }), 5000).catch(() => 0),
        withTimeout(db.adminAction.count({ where: { createdAt: { gte: monthStart } } }), 5000).catch(() => 0),
        withTimeout(db.adminAction.count(), 5000).catch(() => 0),
        withTimeout(
          db.adminAction.groupBy({
            by: ['action'],
            where: { createdAt: { gte: monthStart } },
            _count: true,
            orderBy: { _count: { action: 'desc' } },
            take: 10,
          }),
          5000
        ).catch(() => []),
        withTimeout(
          db.adminAction.groupBy({
            by: ['targetType'],
            where: { createdAt: { gte: monthStart } },
            _count: true,
            orderBy: { _count: { targetType: 'desc' } },
            take: 10,
          }),
          5000
        ).catch(() => []),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          todayCount,
          weekCount,
          monthCount,
          totalCount,
        },
        topActions: (topActions as any[]).map((a: any) => ({ action: a.action, count: a._count })),
        topTargetTypes: (topTargetTypes as any[]).map((t: any) => ({ targetType: t.targetType || 'unknown', count: t._count })),
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    // Build where clause
    const where: any = {}
    if (actionFilter !== 'all') where.action = actionFilter
    if (targetTypeFilter !== 'all') where.targetType = targetTypeFilter === 'null' ? null : targetTypeFilter
    if (adminIdFilter !== 'all') where.adminId = adminIdFilter

    // Date range
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(dateTo)
    }

    // Search (description OR admin email OR action type)
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { admin: { email: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [actions, total, actionTypes] = await Promise.all([
      withNeonRetry(() =>
        db.adminAction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            admin: { select: { id: true, email: true, name: true } },
          },
        })
      ).catch(() => []),
      withTimeout(db.adminAction.count({ where }), 5000).catch(() => 0),
      // Fetch distinct action types for filter dropdown
      withTimeout(
        db.adminAction.groupBy({
          by: ['action'],
          _count: true,
          orderBy: { _count: { action: 'desc' } },
          take: 50,
        }),
        5000
      ).catch(() => []),
    ])

    return NextResponse.json({
      success: true,
      actions: (actions as any[]).map((a: any) => ({
        id: a.id,
        adminId: a.adminId,
        adminEmail: a.admin?.email,
        adminName: a.admin?.name,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        description: a.description,
        metadata: a.metadata,
        ip: a.ip,
        userAgent: a.userAgent,
        createdAt: a.createdAt.toISOString(),
      })),
      actionTypes: (actionTypes as any[]).map((a: any) => ({ action: a.action, count: a._count })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Audit log fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch audit log',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
