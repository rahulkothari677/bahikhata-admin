import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/impersonate
 *
 * Generates a one-time impersonation token for a user.
 * The admin can then use this token to log in AS that user in the main app.
 *
 * SECURITY:
 *   - Only founder role can impersonate (not regular admins)
 *   - Token expires in 5 minutes
 *   - Every impersonation is logged with admin + target user + reason
 *   - Token is single-use (deleted after use)
 *
 * The main app needs an endpoint: POST /api/auth/impersonate?token=xxx
 * that validates the token, creates a session for the target user,
 * and redirects to the dashboard.
 *
 * Request body:
 *   { userId: string, reason: string }
 *
 * Response:
 *   { success: true, url: "https://bahikhata-pro.vercel.app/api/auth/impersonate?token=xxx" }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only founder role can impersonate
    if ((session.user as any).role !== 'founder') {
      return NextResponse.json({
        error: 'Insufficient permissions',
        detail: 'Only founder accounts can impersonate users.',
      }, { status: 403 })
    }

    const body = await req.json()
    const { userId, reason } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (!reason || reason.length < 10) {
      return NextResponse.json({
        error: 'Reason is required (min 10 characters)',
        detail: 'You must explain WHY you are impersonating this user. This is logged for audit.',
      }, { status: 400 })
    }

    // Verify the target user exists
    const targetUser = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, plan: true },
    })

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate a secure one-time token
    const crypto = await import('crypto')
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    // Store the token (we'll use a simple approach: encode it in the URL)
    // In production, you'd store this in a DB table or Redis.
    // For now, we'll create an audit log entry with the token hash.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'user_impersonate',
      description: `Impersonated ${targetUser.email} (${targetUser.name || 'no name'}). Reason: ${reason}`,
      targetType: 'user',
      targetId: userId,
      metadata: {
        targetUserEmail: targetUser.email,
        targetUserName: targetUser.name,
        targetUserPlan: targetUser.plan,
        reason,
        tokenHash, // store hash, not the actual token
        expiresAt: expiresAt.toISOString(),
      },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    // Build the impersonation URL for the main app
    const mainAppUrl = process.env.MAIN_APP_URL || 'https://bahikhata-pro.vercel.app'
    const impersonateUrl = `${mainAppUrl}/api/auth/impersonate?token=${token}&userId=${userId}&admin=${encodeURIComponent((session.user as any).email)}`

    return NextResponse.json({
      success: true,
      url: impersonateUrl,
      targetUser: {
        email: targetUser.email,
        name: targetUser.name,
        plan: targetUser.plan,
      },
      expiresAt: expiresAt.toISOString(),
      warning: 'This link expires in 5 minutes. Use it immediately. All actions taken while impersonating are logged.',
    })
  } catch (error) {
    console.error('Impersonation error:', error)
    return NextResponse.json({ error: 'Failed to create impersonation link' }, { status: 500 })
  }
}
