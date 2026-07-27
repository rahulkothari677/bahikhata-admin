import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'
import { withNeonRetry } from '@/lib/resilience'

/**
 * POST /api/admin/impersonate
 *
 * Generates a one-time impersonation token for a user and stores its hash in
 * the shared ImpersonationToken table. The admin can then click the returned
 * URL to log in AS that user in the main app.
 *
 * 🐛 INTEGRATION PHASE D.3 (2026-07-25): Previously this endpoint only stored
 * the token hash in AdminAction metadata (audit log) — there was no DB table,
 * no single-use enforcement, no expiry check on the consumer side. The main
 * app had no consumer endpoint at all.
 *
 * NOW: This endpoint writes an ImpersonationToken row (shared DB). The main
 * app's GET /api/auth/impersonate consumer validates the token against this
 * table, checks expiry, enforces single-use atomically, and creates a
 * NextAuth session for the target user with isImpersonated=true.
 *
 * SECURITY:
 *   - Only founder role can impersonate (not regular admins)
 *   - Token is 32 random bytes (256 bits) — unguessable
 *   - Only the SHA-256 hash is stored in the DB (not the raw token)
 *   - Token expires in 5 minutes
 *   - Single-use: the main app's consumer marks usedAt=now() atomically
 *   - Every impersonation is logged in BOTH apps:
 *       - AdminAction (here) — admin's perspective
 *       - AuditLog (main app) — target user's perspective
 *     Both logs include the same tokenHash for correlation
 *
 * Request body:
 *   { userId: string, reason: string }
 *
 * Response:
 *   { success: true, url: "https://bahikhata-pro.vercel.app/api/auth/impersonate?token=xxx" }
 *
 * The URL contains ONLY the raw token (no userId, no admin email) — the main
 * app looks up all context from the ImpersonationToken row. This means:
 *   - An attacker who intercepts the URL can't learn the target user
 *   - The token is bound to the targetUserId in the DB (can't be replayed
 *     for a different user)
 */
export const POST = withAdmin(
  'admin/impersonate',
  async (req: NextRequest, ctx) => {
  try {
    // Only founder role can impersonate
    if (ctx.role !== 'founder') {
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

    // Verify the target user exists (reads from shared User table)
    const targetUser = await withNeonRetry(() =>
      db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, plan: true },
      })
    )

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate a secure one-time token: 32 random bytes (256 bits)
    const crypto = await import('crypto')
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    const adminId = ctx.adminId as string
    const adminEmail = ctx.email as string

    // 🐛 INTEGRATION PHASE D.3: Write the ImpersonationToken row to the
    // shared DB. The main app's consumer will look this up by tokenHash.
    // We store ONLY the hash — the raw token is returned to the admin in
    // the URL but never persisted anywhere.
    await withNeonRetry(() =>
      db.impersonationToken.create({
        data: {
          tokenHash,
          adminId,
          adminEmail,
          targetUserId: userId,
          expiresAt,
        },
      })
    )

    // Log to the admin app's AdminAction (audit trail — admin's perspective)
    await logAdminAction({
      adminId,
      action: 'user_impersonate',
      description: `Impersonated ${targetUser.email} (${targetUser.name || 'no name'}). Reason: ${reason}`,
      targetType: 'user',
      targetId: userId,
      metadata: {
        targetUserEmail: targetUser.email,
        targetUserName: targetUser.name,
        targetUserPlan: targetUser.plan,
        reason,
        tokenHash, // for correlation with the main app's AuditLog
        expiresAt: expiresAt.toISOString(),
      },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    // Build the impersonation URL for the main app.
    //
    // 🐛 INTEGRATION PHASE D.3 FIX: The URL is at /api/impersonate (NOT
    // /api/auth/impersonate). The /api/auth/[...nextauth] catch-all in the
    // main app captures ALL /api/auth/* paths, so a route at
    // /api/auth/impersonate would be intercepted by NextAuth and never
    // reach our custom handler. Moving to /api/impersonate avoids the
    // catch-all. The token-in-URL approach is still safe (single-use,
    // 5-min expiry, 256-bit unguessable, HTTPS-only).
    //
    // The URL contains ONLY the raw token — the main app looks up all
    // context (adminId, targetUserId, adminEmail) from the ImpersonationToken
    // row. This prevents an attacker who intercepts the URL from learning
    // the target user, and binds the token to the target (no replay for
    // a different user).
    const mainAppUrl = process.env.MAIN_APP_URL || 'https://bahikhata-pro.vercel.app'
    const impersonateUrl = `${mainAppUrl}/api/impersonate?token=${token}`

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
},
)
