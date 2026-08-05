import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/competitors/[id]
 * Returns a single competitor with update history.
 */
export const GET = withAdmin(
  'admin/competitors/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const competitor = await withNeonRetry(() =>
      db.competitor.findUnique({
        where: { id },
        include: {
          updates: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      })
    ).catch(ctx.degrade('competitor.findUnique', null))

    if (!competitor) {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      competitor: {
        ...competitor,
        features: (() => { try { return JSON.parse(competitor.features || '{}') } catch { return {} } })(),
        createdAt: competitor.createdAt.toISOString(),
        updatedAt: competitor.updatedAt.toISOString(),
        updates: competitor.updates.map((u: any) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
        })),
      },
    })
  } catch (error) {
    console.error('[admin/competitors/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to fetch competitor' }, { status: 500 })
  }
},
)

/**
 * PATCH /api/admin/competitors/[id]
 * Update competitor. Creates CompetitorUpdate entries for changed fields.
 */
export const PATCH = withAdmin(
  'admin/competitors/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, website, description, freePrice, proPrice, elitePrice, features, targetMarket, usp, weaknesses, status } = body

    const existing = await db.competitor.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    // Track changes for audit
    const updates: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []
    const updateData: any = {}

    const fieldsToCheck = [
      { key: 'name', value: name },
      { key: 'website', value: website },
      { key: 'description', value: description },
      { key: 'freePrice', value: freePrice },
      { key: 'proPrice', value: proPrice },
      { key: 'elitePrice', value: elitePrice },
      { key: 'targetMarket', value: targetMarket },
      { key: 'usp', value: usp },
      { key: 'weaknesses', value: weaknesses },
      { key: 'status', value: status },
    ]

    for (const f of fieldsToCheck) {
      if (f.value !== undefined) {
        const oldVal = (existing as any)[f.key] as string | null
        const newVal = f.value || null
        if (oldVal !== newVal) {
          updates.push({ field: f.key, oldValue: oldVal, newValue: newVal })
          updateData[f.key] = newVal
        }
      }
    }

    // Handle features separately (JSON)
    if (features !== undefined) {
      const oldFeatures = existing.features
      const newFeatures = JSON.stringify(features)
      if (oldFeatures !== newFeatures) {
        updates.push({ field: 'features', oldValue: oldFeatures, newValue: newFeatures })
        updateData.features = newFeatures
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, competitor: existing, message: 'No changes' })
    }

    const updated = await db.competitor.update({ where: { id }, data: updateData })

    // Create update log entries
    if (updates.length > 0) {
      await db.competitorUpdate.createMany({
        data: updates.map(u => ({
          competitorId: id,
          field: u.field,
          oldValue: u.oldValue,
          newValue: u.newValue,
          updatedBy: ctx.adminId,
        })),
      })
    }

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'competitor_update',
      description: `Updated competitor "${existing.name}" — ${updates.length} field(s) changed`,
      targetType: 'competitor',
      targetId: id,
    })

    return NextResponse.json({ success: true, competitor: updated })
  } catch (error) {
    console.error('Update competitor error:', error)
    return NextResponse.json({ error: 'Failed to update competitor' }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/competitors/[id]
 * Hard delete (cascade updates).
 */
export const DELETE = withAdmin(
  'admin/competitors/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.competitor.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    await db.competitor.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'competitor_delete',
      description: `Deleted competitor "${existing.name}"`,
      targetType: 'competitor',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Competitor deleted' })
  } catch (error) {
    console.error('[admin/competitors/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to delete competitor' }, { status: 500 })
  }
},
)
