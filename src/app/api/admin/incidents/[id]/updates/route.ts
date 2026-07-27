import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/incidents/[id]/updates
 *
 * Add a new update to an incident's timeline.
 * This also updates the incident's status if a new status is provided.
 *
 * Body:
 *   - message: string (required)
 *   - status: 'investigating' | 'identified' | 'monitoring' | 'resolved' (optional — if provided, updates incident status too)
 */
export const POST = withAdmin(
  'admin/incidents/[id]/updates',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { message, status } = body

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const incident = await db.incident.findUnique({ where: { id } })
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
    }

    // Create the update
    const update = await db.incidentUpdate.create({
      data: {
        incidentId: id,
        message: message.trim(),
        status: status || incident.status,
        createdBy: ctx.adminId,
      },
    })

    // If status provided, update the incident too
    if (status && status !== incident.status) {
      const isNowResolved = status === 'resolved'
      await db.incident.update({
        where: { id },
        data: {
          status,
          resolvedAt: isNowResolved && !incident.resolvedAt ? new Date() : incident.resolvedAt,
        },
      })
    }

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'incident_update_added',
      description: `Added update to incident "${incident.title}"${status ? ` (status → ${status})` : ''}`,
      targetType: 'incident',
      targetId: id,
    })

    return NextResponse.json({ success: true, update })
  } catch (error) {
    console.error('Add incident update error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to add update',    }, { status: 500 })
  }
},
)
