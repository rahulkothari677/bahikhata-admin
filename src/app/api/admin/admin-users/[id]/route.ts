import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/admin-users/[id]
 * Update admin user role or active status (founder only).
 *
 * Body:
 *   - role: 'admin' | 'viewer' (cannot change to/from founder via API)
 *   - isActive: boolean
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const currentRole = (session.user as any).role
    if (currentRole !== 'founder') {
      return NextResponse.json({ error: 'Only founders can modify admin users' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const { role, isActive } = body

    const existing = await db.adminUser.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Admin user not found' }, { status: 404 })
    }

    // Cannot modify founder accounts (except self)
    if (existing.role === 'founder' && existing.id !== (session.user as any).id) {
      return NextResponse.json({ error: 'Cannot modify other founder accounts' }, { status: 403 })
    }

    // Cannot change role to/from founder
    if (role === 'founder') {
      return NextResponse.json({ error: 'Cannot assign founder role via API' }, { status: 400 })
    }

    // Prevent self-deactivation (founder locking themselves out)
    if (isActive === false && existing.id === (session.user as any).id) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 })
    }

    const updateData: any = {}
    if (role !== undefined && role !== 'founder') updateData.role = role
    if (isActive !== undefined) updateData.isActive = isActive

    const updated = await db.adminUser.update({
      where: { id },
      data: updateData,
      select: { id: true, email: true, name: true, role: true, isActive: true, totpEnabled: true, lastLoginAt: true, createdAt: true },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'admin_user_update',
      description: `Updated admin user "${existing.name}" (${existing.email}) — ${role ? `role: ${role}` : ''} ${isActive !== undefined ? `active: ${isActive}` : ''}`,
      targetType: 'admin_user',
      targetId: id,
    })

    return NextResponse.json({ success: true, admin: updated })
  } catch (error) {
    console.error('Update admin user error:', error)
    return NextResponse.json({ error: 'Failed to update admin user' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/admin-users/[id]
 * Delete admin user (founder only, cannot delete self or other founders).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const currentRole = (session.user as any).role
    if (currentRole !== 'founder') {
      return NextResponse.json({ error: 'Only founders can delete admin users' }, { status: 403 })
    }

    const { id } = await params
    const existing = await db.adminUser.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Admin user not found' }, { status: 404 })
    }

    // Cannot delete founder accounts
    if (existing.role === 'founder') {
      return NextResponse.json({ error: 'Cannot delete founder accounts' }, { status: 400 })
    }

    // Cannot delete self
    if (existing.id === (session.user as any).id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    await db.adminUser.delete({ where: { id } })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'admin_user_delete',
      description: `Deleted admin user "${existing.name}" (${existing.email})`,
      targetType: 'admin_user',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Admin user deleted' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete admin user' }, { status: 500 })
  }
}
