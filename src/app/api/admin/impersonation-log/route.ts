import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/impersonation-log
 *
 * Returns impersonation history from AdminAction (action=user_impersonate).
 * Founder-only access.
 *
 * Query: ?tab=overview|list&page=1
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only founders can view impersonation logs
    if ((session.user as any).role !== 'founder') {
      return NextResponse.json({ error: 'Only founders can view impersonation logs' }, { status: 403 })
    }

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    if (tab === 'overview') {
      const [totalCount, todayCount, weekCount, uniqueAdmins, uniqueUsers] = await Promise.all([
        withTimeout(db.adminAction.count({ where: { action: 'user_impersonate' } }), 5000).catch(() => 0),
        withTimeout(
          db.adminAction.count({
            where: {
              action: 'user_impersonate',
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.adminAction.count({
            where: {
              action: 'user_impersonate',
              createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
          }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.adminAction.groupBy({
            by: ['adminId'],
            where: { action: 'user_impersonate' },
            _count: true,
          }),
          5000
        ).catch(() => []),
        withTimeout(
          db.adminAction.groupBy({
            by: ['targetId'],
            where: { action: 'user_impersonate', targetId: { not: null } },
            _count: true,
          }),
          5000
        ).catch(() => []),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          totalCount,
          todayCount,
          weekCount,
          uniqueAdmins: (uniqueAdmins as any[]).length,
          uniqueUsers: (uniqueUsers as any[]).length,
        },
      })
    }

    // List tab
    const skip = (page - 1) * pageSize

    const [logs, total] = await Promise.all([
      withNeonRetry(() =>
        db.adminAction.findMany({
          where: { action: 'user_impersonate' },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: { admin: { select: { email: true, name: true } } },
        })
      ).catch(() => []),
      withTimeout(
        db.adminAction.count({ where: { action: 'user_impersonate' } }),
        5000
      ).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      logs: (logs as any[]).map((l: any) => ({
        id: l.id,
        adminId: l.adminId,
        adminEmail: l.admin?.email,
        adminName: l.admin?.name,
        targetUserId: l.targetId,
        description: l.description,
        metadata: l.metadata,
        ip: l.ip,
        userAgent: l.userAgent,
        createdAt: l.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Impersonation log fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
  }
}
