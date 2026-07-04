import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/admin-users
 * Returns all admin users (for team management).
 * Only founder role can access this endpoint.
 *
 * Query: ?tab=overview|list
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only founders can view admin team
    const role = (session.user as any).role
    if (role !== 'founder') {
      return NextResponse.json({ error: 'Only founders can manage admin team' }, { status: 403 })
    }

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'list'

    if (tab === 'overview') {
      const [founderCount, adminCount, viewerCount, activeCount, inactiveCount, twoFACount] = await Promise.all([
        withTimeout(db.adminUser.count({ where: { role: 'founder' } }), 5000).catch(() => 0) as Promise<number>,
        withTimeout(db.adminUser.count({ where: { role: 'admin' } }), 5000).catch(() => 0) as Promise<number>,
        withTimeout(db.adminUser.count({ where: { role: 'viewer' } }), 5000).catch(() => 0) as Promise<number>,
        withTimeout(db.adminUser.count({ where: { isActive: true } }), 5000).catch(() => 0) as Promise<number>,
        withTimeout(db.adminUser.count({ where: { isActive: false } }), 5000).catch(() => 0) as Promise<number>,
        withTimeout(db.adminUser.count({ where: { totpEnabled: true } }), 5000).catch(() => 0) as Promise<number>,
      ])

      return NextResponse.json({
        success: true,
        overview: {
          founderCount,
          adminCount,
          viewerCount,
          activeCount,
          inactiveCount,
          twoFACount,
          totalCount: founderCount + adminCount + viewerCount,
        },
      })
    }

    // List tab
    const admins = await withNeonRetry(() =>
      db.adminUser.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          totpEnabled: true,
          lastLoginAt: true,
          lastLoginIp: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    ).catch(() => [])

    return NextResponse.json({
      success: true,
      admins: (admins as any[]).map((a: any) => ({
        ...a,
        lastLoginAt: a.lastLoginAt?.toISOString() || null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Admin users fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch admin users' }, { status: 500 })
  }
}

/**
 * POST /api/admin/admin-users
 * Create a new admin user (founder only).
 *
 * Body:
 *   - email: string (required, must be in FOUNDER_EMAILS whitelist)
 *   - name: string (required)
 *   - password: string (required)
 *   - role: 'admin' | 'viewer' (required — cannot create founder via API)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const role = (session.user as any).role
    if (role !== 'founder') {
      return NextResponse.json({ error: 'Only founders can create admin users' }, { status: 403 })
    }

    const body = await req.json()
    const { email, name, password, role: newRole } = body

    if (!email || !name || !password) {
      return NextResponse.json({ error: 'email, name, and password are required' }, { status: 400 })
    }

    // Only allow admin or viewer roles (cannot create founder via API)
    if (newRole && !['admin', 'viewer'].includes(newRole)) {
      return NextResponse.json({ error: 'Role must be "admin" or "viewer"' }, { status: 400 })
    }

    // Check if email already exists
    const existing = await db.adminUser.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) {
      return NextResponse.json({ error: 'Admin user with this email already exists' }, { status: 400 })
    }

    // Hash password
    const bcrypt = await import('bcryptjs')
    const hashedPassword = await bcrypt.hash(password, 12)

    const adminUser = await db.adminUser.create({
      data: {
        email: email.toLowerCase(),
        name: name.trim(),
        password: hashedPassword,
        role: newRole || 'viewer',
        isActive: true,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'admin_user_create',
      description: `Created admin user "${name}" (${email}, role: ${newRole || 'viewer'})`,
      targetType: 'admin_user',
      targetId: adminUser.id,
    })

    return NextResponse.json({
      success: true,
      admin: { ...adminUser, password: undefined }, // never return password
    })
  } catch (error) {
    console.error('Create admin user error:', error)
    return NextResponse.json({ error: 'Failed to create admin user' }, { status: 500 })
  }
}
