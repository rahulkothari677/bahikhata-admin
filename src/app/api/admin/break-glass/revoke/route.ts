import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { getActiveSession } from '@/lib/break-glass'

/**
 * POST /api/admin/break-glass/revoke — end emergency access early.
 *
 * §C4. Sessions expire on their own; this is for closing one the moment the
 * work is done rather than leaving the window open for the remainder of the
 * hour. Deliberately the LOWEST-friction operation in this feature: no TOTP,
 * no reason. Making it harder than activation would leave windows open out of
 * inconvenience, which is the opposite of the point.
 *
 * Any founder may revoke, not only the one who opened it — if a session was
 * opened by a compromised account, the person shutting it down is by
 * definition not that account.
 */
export const POST = withAdmin('admin/break-glass/revoke', async (_req: NextRequest, ctx) => {
  if (ctx.role !== 'founder') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Only a founder can revoke break-glass access.', requestId: ctx.requestId } },
      { status: 403 },
    )
  }

  const active = await getActiveSession()
  if (!active) {
    // Not an error worth failing over: "there is nothing to revoke" is the
    // desired end state, and an operator hitting this twice in a panic should
    // not see a red screen.
    return NextResponse.json({
      success: true,
      alreadyClosed: true,
      message: 'No break-glass session is currently active.',
      requestId: ctx.requestId,
    })
  }

  // Conditional update: revoke ONLY if still un-revoked. Two founders hitting
  // this simultaneously must not produce two audit entries claiming to be the
  // one that closed it.
  const result = await db.breakGlassSession.updateMany({
    where: { id: active.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: ctx.adminId },
  })

  if (result.count === 0) {
    return NextResponse.json({
      success: true,
      alreadyClosed: true,
      message: 'That session was already closed by someone else.',
      requestId: ctx.requestId,
    })
  }

  await ctx.audit({
    action: 'break_glass_revoked',
    description:
      `Break-glass access revoked by ${ctx.email} — was opened by ${active.adminEmail} ` +
      `with ${active.minutesRemaining} minute(s) still remaining. Original reason: ${active.reason}`,
    targetType: 'break_glass',
    targetId: active.id,
  })

  return NextResponse.json({
    success: true,
    revokedSessionId: active.id,
    message: 'Emergency access closed.',
    requestId: ctx.requestId,
  })
})
