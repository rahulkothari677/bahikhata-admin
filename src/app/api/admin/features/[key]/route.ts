import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

/**
 * PATCH /api/admin/features/[key]
 * Toggles a feature flag on/off with audit trail.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { key } = await params
    const body = await req.json()
    const { enabled } = body

    const flag = await db.featureFlag.findUnique({ where: { key } })
    if (!flag) {
      return NextResponse.json({ error: 'Feature flag not found' }, { status: 404 })
    }

    const oldValue = flag.enabled
    const updated = await db.featureFlag.update({
      where: { key },
      data: {
        enabled,
        updatedAt: new Date(),
        updatedBy: (session.user as any).email,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'feature_toggle',
      description: `Toggled "${flag.label}" (${key}) from ${oldValue ? 'ON' : 'OFF'} to ${enabled ? 'ON' : 'OFF'}`,
      targetType: 'feature_flag',
      targetId: key,
      metadata: { before: { enabled: oldValue }, after: { enabled } },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({
      success: true,
      flag: updated,
      message: `"${flag.label}" is now ${enabled ? 'ENABLED' : 'DISABLED'}`,
    })
  } catch (error) {
    console.error('Feature toggle error:', error)
    return NextResponse.json({ error: 'Failed to toggle feature' }, { status: 500 })
  }
}

/**
 * POST /api/admin/features/[key]
 * Create a new feature flag
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { key } = await params
    const body = await req.json()
    const { label, description, enabled = true } = body

    const flag = await db.featureFlag.create({
      data: {
        id: `flag_${key}`,
        key,
        label,
        description,
        enabled,
        updatedAt: new Date(),
        updatedBy: (session.user as any).email,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'feature_create',
      description: `Created feature flag "${label}" (${key})`,
      targetType: 'feature_flag',
      targetId: key,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ success: true, flag })
  } catch (error) {
    console.error('Feature create error:', error)
    return NextResponse.json({ error: 'Failed to create feature flag' }, { status: 500 })
  }
}
