import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      updateData.resolvedBy = (session.user as any).email
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
      adminId: (session.user as any).id,
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
}
