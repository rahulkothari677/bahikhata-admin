import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/partners/[id]
 * Returns a single partner.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const partner = await withTimeout(
      db.partner.findUnique({ where: { id } }),
      5000
    ).catch(() => null)

    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, partner })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch partner' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/partners/[id]
 * Update partner fields.
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
    const {
      name, type, status, contactName, contactEmail, contactPhone, website,
      apiBaseUrl, webhookUrl, revenueSharePct, contractStartAt, contractEndAt, notes,
    } = body

    const existing = await db.partner.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    const updated = await db.partner.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(type !== undefined && { type }),
        ...(status !== undefined && { status }),
        ...(contactName !== undefined && { contactName }),
        ...(contactEmail !== undefined && { contactEmail }),
        ...(contactPhone !== undefined && { contactPhone }),
        ...(website !== undefined && { website }),
        ...(apiBaseUrl !== undefined && { apiBaseUrl }),
        ...(webhookUrl !== undefined && { webhookUrl }),
        ...(revenueSharePct !== undefined && { revenueSharePct: parseFloat(revenueSharePct) || 0 }),
        ...(contractStartAt !== undefined && { contractStartAt: contractStartAt ? new Date(contractStartAt) : null }),
        ...(contractEndAt !== undefined && { contractEndAt: contractEndAt ? new Date(contractEndAt) : null }),
        ...(notes !== undefined && { notes }),
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'partner_update',
      description: `Updated partner "${existing.name}"`,
      targetType: 'partner',
      targetId: id,
    })

    return NextResponse.json({ success: true, partner: updated })
  } catch (error) {
    console.error('Update partner error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update partner',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/partners/[id]
 * Hard delete a partner.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.partner.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    await db.partner.delete({ where: { id } })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'partner_delete',
      description: `Deleted partner "${existing.name}"`,
      targetType: 'partner',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Partner deleted' })
  } catch (error) {
    console.error('Delete partner error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete partner',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
