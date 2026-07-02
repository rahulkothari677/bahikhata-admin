import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/audit-log
 * Returns all admin actions (last 500) with admin user details.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const actions = await db.adminAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        admin: { select: { email: true, name: true } },
      },
    })

    return NextResponse.json({ success: true, actions })
  } catch (error) {
    console.error('Audit log fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 })
  }
}
