import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/bulk
 *
 * Perform bulk operations on multiple users at once.
 *
 * Body:
 *   {
 *     action: 'export' | 'change_plan' | 'message' | 'ban' | 'delete',
 *     userIds: string[],
 *     params: { plan?: string, message?: string }  // action-specific params
 *   }
 *
 * Actions:
 *   - export: Returns user data as CSV (doesn't modify anything)
 *   - change_plan: Updates all users' plan (with audit trail)
 *   - message: Creates an announcement targeting these users
 *   - ban: Sets cancelledAt + plan='free' for all users
 *   - delete: Permanently deletes users (CAREFUL — irreversible)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only founder can do bulk delete
    const body = await req.json()
    const { action, userIds, params = {} } = body

    if (!action || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'Action and userIds are required' }, { status: 400 })
    }

    if (userIds.length > 1000) {
      return NextResponse.json({ error: 'Max 1000 users per bulk operation' }, { status: 400 })
    }

    let result: any = {}

    switch (action) {
      case 'export': {
        const users = await db.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true, email: true, name: true, phone: true, plan: true,
            role: true, createdAt: true, updatedAt: true, renewsAt: true,
            _count: { select: { transactions: true, products: true, parties: true } },
          },
        })

        // Build CSV
        const headers = ['ID', 'Email', 'Name', 'Phone', 'Plan', 'Role', 'Joined', 'Last Active', 'Renews', 'Transactions', 'Products', 'Parties']
        const rows = users.map(u => [
          u.id, u.email, u.name || '', u.phone || '', u.plan, u.role,
          u.createdAt.toISOString(), u.updatedAt.toISOString(),
          u.renewsAt?.toISOString() || '',
          u._count.transactions, u._count.products, u._count.parties,
        ].join(','))

        const csv = [headers.join(','), ...rows].join('\n')

        return NextResponse.json({
          success: true,
          action: 'export',
          count: users.length,
          csv,
          filename: `users-export-${new Date().toISOString().split('T')[0]}.csv`,
        })
      }

      case 'change_plan': {
        if (!['free', 'pro', 'elite'].includes(params.plan)) {
          return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
        }

        const updated = await db.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            plan: params.plan,
            renewsAt: params.plan === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        })

        await logAdminAction({
          adminId: (session.user as any).id,
          action: 'bulk_plan_change',
          description: `Bulk changed ${updated.count} users to ${params.plan}`,
          targetType: 'user',
          targetId: 'bulk',
          metadata: { userIds: userIds.slice(0, 50), count: updated.count, newPlan: params.plan },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'change_plan', count: updated.count, plan: params.plan }
        break
      }

      case 'message': {
        if (!params.title || !params.message) {
          return NextResponse.json({ error: 'Title and message required for bulk message' }, { status: 400 })
        }

        const announcement = await db.announcement.create({
          data: {
            id: `ann_bulk_${Date.now()}`,
            title: params.title,
            message: params.message,
            type: params.type || 'info',
            isActive: true,
            startsAt: new Date(),
            createdBy: (session.user as any).email,
          },
        })

        await logAdminAction({
          adminId: (session.user as any).id,
          action: 'bulk_message',
          description: `Sent "${params.title}" to ${userIds.length} users`,
          targetType: 'announcement',
          targetId: announcement.id,
          metadata: { userIds: userIds.slice(0, 50), count: userIds.length, title: params.title },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'message', count: userIds.length, announcementId: announcement.id }
        break
      }

      case 'ban': {
        const banned = await db.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            plan: 'free',
            cancelledAt: new Date(),
            renewsAt: null,
          },
        })

        await logAdminAction({
          adminId: (session.user as any).id,
          action: 'bulk_ban',
          description: `Banned ${banned.count} users (set to free + cancelled)`,
          targetType: 'user',
          targetId: 'bulk',
          metadata: { userIds: userIds.slice(0, 50), count: banned.count },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'ban', count: banned.count }
        break
      }

      case 'delete': {
        // Only founder can delete
        if ((session.user as any).role !== 'founder') {
          return NextResponse.json({ error: 'Only founder can delete users' }, { status: 403 })
        }

        // Double-confirm with reason
        if (!params.confirm || params.confirm !== 'DELETE_PERMANENTLY') {
          return NextResponse.json({
            error: 'Confirmation required',
            detail: 'Set params.confirm to "DELETE_PERMANENTLY" to confirm. This is IRREVERSIBLE.',
          }, { status: 400 })
        }

        const deleted = await db.user.deleteMany({
          where: { id: { in: userIds } },
        })

        await logAdminAction({
          adminId: (session.user as any).id,
          action: 'bulk_delete',
          description: `PERMANENTLY DELETED ${deleted.count} users`,
          targetType: 'user',
          targetId: 'bulk',
          metadata: { userIds: userIds.slice(0, 50), count: deleted.count },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        })

        result = { action: 'delete', count: deleted.count }
        break
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Bulk operation error:', error)
    return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 })
  }
}
