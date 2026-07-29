import { NextRequest, NextResponse } from 'next/server'
import { authenticator } from 'otplib'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { checkTotpRate, resetTotpRate } from '@/lib/admin-rate-limit'
import {
  getActiveSession,
  listRecentSessions,
  validateActivation,
} from '@/lib/break-glass'

/**
 * GET  /api/admin/break-glass — is emergency access live? plus recent history
 * POST /api/admin/break-glass — activate (founder + fresh TOTP + written reason)
 *
 * §C4. See src/lib/break-glass.ts for the design reasoning. The physical
 * counterpart — what to do when you are locked out entirely and cannot reach
 * this endpoint at all — is docs/RUNBOOK-lockout.md.
 */

export const GET = withAdmin('admin/break-glass', async (_req: NextRequest, ctx) => {
  const [active, recent] = await Promise.all([
    getActiveSession(),
    listRecentSessions(30),
  ])

  // Deliberately NOT audited. The admin UI polls this on every page load to
  // render the banner; auditing a read that happens constantly would bury the
  // activations — the entries that matter — under thousands of routine rows.
  return NextResponse.json({
    active,
    // Surfaced even when empty. "No sessions in 30 days" is a useful answer;
    // an absent section is indistinguishable from a broken query.
    recent: recent.map(s => ({
      id: s.id,
      adminEmail: s.adminEmail,
      reason: s.reason,
      approvedBy: s.approvedBy,
      startedAt: s.startedAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      selfApproved: s.approvedBy === null,
    })),
    requestId: ctx.requestId,
  })
})

export const POST = withAdmin('admin/break-glass', async (req: NextRequest, ctx) => {
  // Founder only. withAdmin already enforces this from the route policy; the
  // check is repeated because the consequence of a policy typo here is that
  // any operator can open emergency access, and defence in depth is cheap.
  if (ctx.role !== 'founder') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Only a founder can open break-glass access.', requestId: ctx.requestId } },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => ({}))

  const validation = validateActivation(body)
  if (!validation.ok) {
    return NextResponse.json(
      { error: { ...validation.error, requestId: ctx.requestId } },
      { status: 400 },
    )
  }

  // One at a time. Two overlapping sessions make "who was in, under what
  // reason, when" ambiguous — which is the only question this table exists to
  // answer.
  const existing = await getActiveSession()
  if (existing) {
    return NextResponse.json(
      {
        error: {
          code: 'ALREADY_ACTIVE',
          message: `Break-glass is already active (opened by ${existing.adminEmail}, ${existing.minutesRemaining} minutes remaining). Revoke it before opening another.`,
          requestId: ctx.requestId,
        },
      },
      { status: 409 },
    )
  }

  // 🔒 A FRESH second factor, not the one from login. Break-glass is exactly
  // what someone with a stolen session would reach for, and a stolen session
  // already carries whatever factor was proved at sign-in.
  const totpCode = typeof body.totpCode === 'string' ? body.totpCode.trim() : ''
  if (!/^\d{6}$/.test(totpCode)) {
    return NextResponse.json(
      { error: { code: 'TOTP_REQUIRED', message: 'Enter the 6-digit code from your authenticator app.', requestId: ctx.requestId } },
      { status: 400 },
    )
  }

  const rate = await checkTotpRate(ctx.adminId)
  if (!rate.success) {
    await ctx.audit({
      action: 'break_glass_rate_limited',
      description: 'Break-glass activation blocked by TOTP rate limit',
      targetType: 'admin_user',
      targetId: ctx.adminId,
    })
    return NextResponse.json(
      { error: { code: 'TOO_MANY_ATTEMPTS', message: `Too many incorrect codes. Try again in ${rate.retryAfterSec} seconds.`, requestId: ctx.requestId } },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    )
  }

  const admin = await db.adminUser.findUnique({
    where: { id: ctx.adminId },
    select: { totpSecret: true, totpEnabled: true, email: true },
  })

  if (!admin?.totpEnabled || !admin.totpSecret) {
    // Not a silent pass. If the founder has no second factor, the lockout
    // runbook is the correct path — not an unverified emergency session.
    return NextResponse.json(
      {
        error: {
          code: 'TOTP_NOT_CONFIGURED',
          message: 'Two-factor authentication must be enabled to open break-glass access. See docs/RUNBOOK-lockout.md.',
          requestId: ctx.requestId,
        },
      },
      { status: 403 },
    )
  }

  authenticator.options = { window: 1 }
  if (!authenticator.verify({ token: totpCode, secret: admin.totpSecret })) {
    await ctx.audit({
      action: 'break_glass_failed',
      description: 'Break-glass activation failed — incorrect TOTP code',
      targetType: 'admin_user',
      targetId: ctx.adminId,
    })
    return NextResponse.json(
      { error: { code: 'INVALID_CODE', message: 'That code is not valid. Check your authenticator app.', requestId: ctx.requestId } },
      { status: 401 },
    )
  }

  await resetTotpRate(ctx.adminId)

  const now = new Date()
  const expiresAt = new Date(now.getTime() + validation.durationMinutes * 60_000)

  const session = await db.breakGlassSession.create({
    data: {
      adminId: ctx.adminId,
      adminEmail: admin.email ?? ctx.email,
      reason: validation.reason,
      // Null = self-approved. The report allows a documented single-founder
      // override for the genuine "I am the only founder at 3am" case; storing
      // null rather than the activator's own id keeps those countable instead
      // of disguising them as approved.
      approvedBy: typeof body.approvedBy === 'string' && body.approvedBy.trim() ? body.approvedBy.trim() : null,
      startedAt: now,
      expiresAt,
    },
  })

  // 🔴 The loud part. This is in MUST_BE_AUDITED territory: if the audit write
  // fails, ctx.audit rethrows and the activation fails with it. An unlogged
  // break-glass is worse than no break-glass.
  await ctx.audit({
    action: 'break_glass_activated',
    description:
      `BREAK-GLASS ACTIVATED by ${admin.email ?? ctx.email} for ${validation.durationMinutes} minutes` +
      `${session.approvedBy ? ` (approved by ${session.approvedBy})` : ' (SELF-APPROVED — no second founder)'}` +
      ` — reason: ${validation.reason}`,
    targetType: 'break_glass',
    targetId: session.id,
  })

  return NextResponse.json({
    success: true,
    session: {
      id: session.id,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      durationMinutes: validation.durationMinutes,
      selfApproved: session.approvedBy === null,
    },
    // Stated back so the operator knows it was recorded, and that it expires by
    // itself rather than needing to be remembered.
    notice: `Emergency access is open until ${expiresAt.toISOString()} and expires on its own. Every founder should be told now.`,
    requestId: ctx.requestId,
  })
})
