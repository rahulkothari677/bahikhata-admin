import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/features
 *
 * Returns feature flags with analytics (toggle history from audit log).
 *
 * Query: ?tab=overview|list
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.error

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'

    // Fetch all flags
    const flags = await withNeonRetry(() =>
      db.featureFlag.findMany({ orderBy: { key: 'asc' } })
    ).catch(() => [])

    if (tab === 'overview') {
      const [enabledCount, disabledCount, totalCount, recentToggles, toggleCount30d] = await Promise.all([
        withTimeout(db.featureFlag.count({ where: { enabled: true } }), 5000).catch(() => 0),
        withTimeout(db.featureFlag.count({ where: { enabled: false } }), 5000).catch(() => 0),
        withTimeout(db.featureFlag.count(), 5000).catch(() => 0),
        withNeonRetry(() =>
          db.adminAction.findMany({
            where: { action: { in: ['feature_toggle', 'feature_create'] } },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { admin: { select: { email: true, name: true } } },
          })
        ).catch(() => []),
        withTimeout(
          db.adminAction.count({
            where: {
              action: 'feature_toggle',
              createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
          5000
        ).catch(() => 0),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          enabledCount,
          disabledCount,
          totalCount,
          toggleCount30d,
        },
        recentToggles: (recentToggles as any[]).map((a: any) => ({
          id: a.id,
          action: a.action,
          description: a.description,
          adminEmail: a.admin?.email,
          adminName: a.admin?.name,
          createdAt: a.createdAt.toISOString(),
          metadata: a.metadata,
        })),
        flags: flags.map((f: any) => ({
          ...f,
          updatedAt: f.updatedAt.toISOString(),
        })),
      })
    }

    // List tab — return flags with toggle count per flag
    const toggleCounts = await withNeonRetry(() =>
      db.adminAction.groupBy({
        by: ['targetId'],
        where: { action: 'feature_toggle' },
        _count: true,
      })
    ).catch(() => [])

    const toggleMap = new Map<string, number>()
    for (const t of toggleCounts as any[]) {
      if (t.targetId) toggleMap.set(t.targetId, t._count)
    }

    return NextResponse.json({
      success: true,
      flags: flags.map((f: any) => ({
        ...f,
        updatedAt: f.updatedAt.toISOString(),
        toggleCount: toggleMap.get(f.key) || 0,
      })),
    })
  } catch (error) {
    console.error('Fetch features error:', error)
    return NextResponse.json({ error: 'Failed to fetch features' }, { status: 500 })
  }
}
