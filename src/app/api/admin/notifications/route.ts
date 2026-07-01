import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/notifications
 *
 * Creates a broadcast announcement that appears in all users' notification center.
 * Supports targeting by segment (active, at-risk, churned, power, new).
 *
 * Request body:
 *   {
 *     title: string,
 *     message: string,
 *     type: 'info' | 'warning' | 'success' | 'promo',
 *     link?: string,
 *     targetSegment?: 'all' | 'active' | 'atRisk' | 'churned' | 'power' | 'new',
 *     startsAt?: ISO string,
 *     endsAt?: ISO string,
 *   }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { title, message, type = 'info', link, targetSegment = 'all', startsAt, endsAt } = body

    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 })
    }

    // Create the announcement
    const announcement = await db.announcement.create({
      data: {
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        message,
        type,
        link: link || null,
        isActive: true,
        startsAt: startsAt ? new Date(startsAt) : new Date(),
        endsAt: endsAt ? new Date(endsAt) : null,
        createdBy: (session.user as any).email,
      },
    })

    // Log the admin action
    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'notification_broadcast',
      description: `Sent "${title}" to ${targetSegment} segment`,
      targetType: 'announcement',
      targetId: announcement.id,
      metadata: { title, type, targetSegment },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({
      success: true,
      announcement,
      message: `Notification "${title}" will appear for ${targetSegment} users`,
    })
  } catch (error) {
    console.error('Create notification error:', error)
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 })
  }
}

/**
 * GET /api/admin/notifications
 * Returns all announcements (active + past)
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const announcements = await db.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return NextResponse.json({ success: true, announcements })
  } catch (error) {
    console.error('Fetch notifications error:', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/notifications
 * Deactivates an announcement (soft delete)
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Announcement ID required' }, { status: 400 })
    }

    await db.announcement.update({
      where: { id },
      data: { isActive: false },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'notification_deactivated',
      description: `Deactivated announcement ${id}`,
      targetType: 'announcement',
      targetId: id,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ success: true, message: 'Notification deactivated' })
  } catch (error) {
    console.error('Delete notification error:', error)
    return NextResponse.json({ error: 'Failed to delete notification' }, { status: 500 })
  }
}
