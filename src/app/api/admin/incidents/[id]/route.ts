import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/incidents/[id]
 * Returns a single incident with all its updates.
 */
export const GET = withAdmin(
  'admin/incidents/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const incident = await withTimeout(
      db.incident.findUnique({
        where: { id },
        include: {
          updates: { orderBy: { createdAt: 'desc' } },
        },
      }),
      5000
    ).catch(() => null)

    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      incident: {
        ...incident,
        startedAt: incident.startedAt.toISOString(),
        resolvedAt: incident.resolvedAt?.toISOString() || null,
        createdAt: incident.createdAt.toISOString(),
        updatedAt: incident.updatedAt.toISOString(),
        updates: incident.updates.map((u: any) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
        })),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch incident' }, { status: 500 })
  }
},
)

/**
 * PATCH /api/admin/incidents/[id]
 * Update incident fields. If status changes to 'resolved', set resolvedAt.
 */
export const PATCH = withAdmin(
  'admin/incidents/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { title, description, severity, status, service } = body

    const existing = await db.incident.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
    }

    const wasResolved = existing.status === 'resolved'
    const isNowResolved = status === 'resolved'

    const updated = await db.incident.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(severity !== undefined && { severity }),
        ...(status !== undefined && {
          status,
          resolvedAt: isNowResolved && !wasResolved ? new Date() : (isNowResolved ? existing.resolvedAt : null),
        }),
        ...(service !== undefined && { service }),
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'incident_update',
      description: `Updated incident "${existing.title}" — status: ${status || existing.status}`,
      targetType: 'incident',
      targetId: id,
    })

    return NextResponse.json({ success: true, incident: updated })
  } catch (error) {
    console.error('Update incident error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update incident',    }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/incidents/[id]
 * Hard delete (cascade updates).
 */
export const DELETE = withAdmin(
  'admin/incidents/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.incident.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
    }

    await db.incident.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'incident_delete',
      description: `Deleted incident "${existing.title}"`,
      targetType: 'incident',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Incident deleted' })
  } catch (error) {
    console.error('Delete incident error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete incident',    }, { status: 500 })
  }
},
)
