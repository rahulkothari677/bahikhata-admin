import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/support/[id]
 * Update a support ticket (assign, respond, change status, change priority)
 *
 * Body can include:
 *   { status, priority, assignedTo, response }
 *
 * If response is provided and status is set to 'resolved', marks as resolved.
 */
export const PATCH = withAdmin(
  'admin/support/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()
    const { status, priority, assignedTo, response } = body

    const ticket = await db.supportTicket.findUnique({ where: { id } })
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const oldValues = {
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo,
      response: ticket.response,
    }

    const updateData: any = {}
    if (status) updateData.status = status
    if (priority) updateData.priority = priority
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo
    if (response !== undefined) updateData.response = response

    // If resolving, set resolvedAt + resolvedBy
    if (status === 'resolved' && !ticket.resolvedAt) {
      updateData.resolvedAt = new Date()
      updateData.resolvedBy = ctx.email
    }

    // If reopening, clear resolvedAt
    if (status === 'open' && ticket.resolvedAt) {
      updateData.resolvedAt = null
      updateData.resolvedBy = null
    }

    const updated = await db.supportTicket.update({
      where: { id },
      data: updateData,
      include: { user: { select: { email: true, name: true } } },
    })

    // Log with diff
    await logAdminAction({
      adminId: ctx.adminId,
      action: 'support_ticket_update',
      description: `Updated ticket #${id.slice(-6)}: ${ticket.subject}`,
      targetType: 'support_ticket',
      targetId: id,
      metadata: { before: oldValues, after: updateData },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({
      success: true,
      ticket: updated,
      message: `Ticket #${id.slice(-6)} updated`,
    })
  } catch (error) {
    console.error('Ticket update error:', error)
    return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 })
  }
},
)
