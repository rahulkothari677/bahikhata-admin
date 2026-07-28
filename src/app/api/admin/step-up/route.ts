import { NextRequest, NextResponse } from 'next/server'
import { authenticator } from 'otplib'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/with-admin'
import { isStepUpValid, stepUpRemainingSeconds } from '@/lib/step-up'

/**
 * Step-up authentication: re-prove possession of the second factor.
 *
 * GET  — how much of the current grant is left (so the UI can prompt ahead of
 *        time rather than failing an operator mid-action).
 * POST — verify a TOTP code and start a fresh grant.
 *
 * WHY (audit 2026-07-27): 11 routes are marked `stepUp: true` in ROUTE_POLICY
 * — impersonation, exports, the SQL console, admin-user management. That flag
 * was never read. A one-hour session was therefore enough to reach all of them
 * from an unlocked laptop or a stolen cookie. Being logged in is not the same
 * as being present.
 */

const VerifySchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
})

export const GET = withAdmin('admin/step-up', async (_req: NextRequest, ctx) => {
  const admin = await db.adminUser.findUnique({
    where: { id: ctx.adminId },
    select: { stepUpVerifiedAt: true },
  })

  return NextResponse.json({
    success: true,
    active: isStepUpValid(admin?.stepUpVerifiedAt),
    remainingSeconds: stepUpRemainingSeconds(admin?.stepUpVerifiedAt),
  })
})

export const POST = withAdmin('admin/step-up', async (req: NextRequest, ctx) => {
  const parsed = VerifySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_BODY',
          message: 'Enter the 6-digit code from your authenticator app.',
          requestId: ctx.requestId,
        },
      },
      { status: 400 },
    )
  }

  const admin = await db.adminUser.findUnique({
    where: { id: ctx.adminId },
    select: { totpSecret: true, totpEnabled: true },
  })

  if (!admin?.totpEnabled || !admin.totpSecret) {
    return NextResponse.json(
      {
        error: {
          code: 'TOTP_NOT_CONFIGURED',
          message: 'Set up two-factor authentication before using sensitive actions.',
          requestId: ctx.requestId,
        },
      },
      { status: 403 },
    )
  }

  // window: 1 tolerates one 30s step of clock drift either way. Wider would
  // extend how long a shoulder-surfed code stays usable.
  authenticator.options = { window: 1 }
  const ok = authenticator.verify({ token: parsed.data.totpCode, secret: admin.totpSecret })

  if (!ok) {
    // A failed step-up is security-relevant: it is someone at a privileged
    // session who cannot produce the second factor.
    await ctx.audit({
      action: 'step_up_failed',
      description: 'Step-up verification failed — incorrect TOTP code',
      targetType: 'admin_user',
      targetId: ctx.adminId,
    })
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_CODE',
          message: 'That code is not valid. Check your authenticator app and try again.',
          requestId: ctx.requestId,
        },
      },
      { status: 401 },
    )
  }

  await db.adminUser.update({
    where: { id: ctx.adminId },
    data: { stepUpVerifiedAt: new Date() },
  })

  await ctx.audit({
    action: 'step_up_verified',
    description: 'Step-up verification succeeded — sensitive actions unlocked',
    targetType: 'admin_user',
    targetId: ctx.adminId,
  })

  return NextResponse.json({
    success: true,
    active: true,
    remainingSeconds: stepUpRemainingSeconds(new Date()),
  })
})
