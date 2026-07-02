import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/competitors
 * Returns competitors + comparison data.
 * Query: ?tab=overview|list&status=all|active|inactive
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'
    const status = url.searchParams.get('status') || 'all'

    if (tab === 'overview') {
      const [activeCount, inactiveCount, updateCount30d, competitors] = await Promise.all([
        withTimeout(db.competitor.count({ where: { status: 'active' } }), 5000).catch(() => 0),
        withTimeout(db.competitor.count({ where: { status: 'inactive' } }), 5000).catch(() => 0),
        withTimeout(
          db.competitorUpdate.count({
            where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          }),
          5000
        ).catch(() => 0),
        withNeonRetry(() =>
          db.competitor.findMany({
            where: { status: 'active' },
            select: { id: true, name: true, freePrice: true, proPrice: true, elitePrice: true, website: true },
            orderBy: { name: 'asc' },
          })
        ).catch(() => []),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          activeCount,
          inactiveCount,
          updateCount30d,
          totalCount: activeCount + inactiveCount,
        },
        competitors: competitors.map((c: any) => ({
          ...c,
          features: (() => { try { return JSON.parse(c.features || '{}') } catch { return {} } })(),
        })),
      })
    }

    // List tab
    const where: any = {}
    if (status !== 'all') where.status = status

    const competitors = await withNeonRetry(() =>
      db.competitor.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { updates: true } },
        },
      })
    ).catch(() => [])

    return NextResponse.json({
      success: true,
      competitors: (competitors as any[]).map((c: any) => ({
        id: c.id,
        name: c.name,
        website: c.website,
        description: c.description,
        freePrice: c.freePrice,
        proPrice: c.proPrice,
        elitePrice: c.elitePrice,
        features: (() => { try { return JSON.parse(c.features || '{}') } catch { return {} } })(),
        targetMarket: c.targetMarket,
        usp: c.usp,
        weaknesses: c.weaknesses,
        status: c.status,
        updateCount: c._count?.updates || 0,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Competitors fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch competitors' }, { status: 500 })
  }
}

/**
 * POST /api/admin/competitors
 * Create a new competitor.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, website, description, freePrice, proPrice, elitePrice, features, targetMarket, usp, weaknesses } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const competitor = await db.competitor.create({
      data: {
        name: name.trim(),
        website: website || null,
        description: description || null,
        freePrice: freePrice || null,
        proPrice: proPrice || null,
        elitePrice: elitePrice || null,
        features: JSON.stringify(features || {}),
        targetMarket: targetMarket || null,
        usp: usp || null,
        weaknesses: weaknesses || null,
        status: 'active',
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'competitor_create',
      description: `Added competitor "${name}"`,
      targetType: 'competitor',
      targetId: competitor.id,
    })

    return NextResponse.json({ success: true, competitor })
  } catch (error) {
    console.error('Create competitor error:', error)
    return NextResponse.json({ error: 'Failed to create competitor' }, { status: 500 })
  }
}
