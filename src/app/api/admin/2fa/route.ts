import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { authenticator } from 'otplib'
import { logAdminAction } from '@/lib/audit'
import { withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/2fa
 * Returns 2FA status + generates a new secret + QR code if not enabled.
 *
 * 🐛 FIX (admin-login-fix-phase-1): This endpoint is now ALSO the entry point
 * for the grace-session 2FA-setup flow. When a user logs in with valid
 * email+password but hasn't set up 2FA yet, they get a grace session
 * (requires2FASetup=true) that can ONLY access /setup-2fa + this endpoint
 * + /api/auth/signout (enforced in middleware.ts). The session.user.id is
 * present in both grace and normal sessions, so no code changes were needed
 * here — the existing logic "if not enabled, generate a new secret" already
 * does the right thing for grace sessions.
 */
export const GET = withAdmin(
  'admin/2fa',
  async (req: NextRequest, ctx) => {
  try {
    const admin = await withNeonRetry(() =>
      db.adminUser.findUnique({
        where: { id: ctx.adminId },
        select: { totpEnabled: true, totpSecret: true, email: true },
      })
    )

    if (!admin) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    if (admin.totpEnabled) {
      return NextResponse.json({
        success: true,
        enabled: true,
        message: '2FA is already enabled on your account.',
      })
    }

    // Generate a new secret for setup
    const secret = authenticator.generateSecret()
    const otpauthUrl = authenticator.keyuri(admin.email, 'BahiKhata Admin', secret)

    // Store the secret temporarily (not enabled yet — only enabled after verification)
    // 🐛 FIX (admin-login-fix-phase-1-followup-2): wrap with withNeonRetry
    await withNeonRetry(() =>
      db.adminUser.update({
        where: { id: ctx.adminId },
        data: { totpSecret: secret },
      })
    )

    return NextResponse.json({
      success: true,
      enabled: false,
      secret,
      otpauthUrl,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`,
      manualEntry: secret,
      instructions: [
        '1. Open Google Authenticator (or Authy, 1Password, etc.)',
        '2. Tap "+" → "Scan QR code" OR "Enter setup key"',
        '3. Scan the QR code OR enter the secret manually',
        '4. Enter the 6-digit code from your app to verify',
      ],
    })
  } catch (error) {
    console.error('2FA setup error:', error)
    return NextResponse.json({ error: 'Failed to setup 2FA' }, { status: 500 })
  }
},
)

/**
 * POST /api/admin/2fa
 * Verify the TOTP code and enable 2FA.
 * Body: { code: "123456" }
 */
export const POST = withAdmin(
  'admin/2fa',
  async (req: NextRequest, ctx) => {
  try {
    const body = await req.json()
    const { code } = body

    if (!code || code.length !== 6) {
      return NextResponse.json({ error: 'Invalid code. Enter the 6-digit code from your authenticator app.' }, { status: 400 })
    }

    const admin = await withNeonRetry(() =>
      db.adminUser.findUnique({
        where: { id: ctx.adminId },
        select: { totpSecret: true, totpEnabled: true, email: true },
      })
    )

    if (!admin) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    if (admin.totpEnabled) {
      return NextResponse.json({ error: '2FA is already enabled' }, { status: 400 })
    }

    if (!admin.totpSecret) {
      return NextResponse.json({ error: 'No 2FA secret found. Visit GET /api/admin/2fa first.' }, { status: 400 })
    }

    // Verify the code
    const isValid = authenticator.verify({
      token: code,
      secret: admin.totpSecret,
    })

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
    }

    // Enable 2FA
    // 🐛 FIX (admin-login-fix-phase-1-followup-2): wrap with withNeonRetry
    await withNeonRetry(() =>
      db.adminUser.update({
        where: { id: ctx.adminId },
        data: { totpEnabled: true },
      })
    )

    await logAdminAction({
      adminId: ctx.adminId,
      action: '2fa_enabled',
      description: `Enabled 2FA on admin account`,
      targetType: 'admin_user',
      targetId: ctx.adminId,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({
      success: true,
      message: '2FA enabled successfully! You will now need a code from your authenticator app to log in.',
    })
  } catch (error) {
    console.error('2FA verify error:', error)
    return NextResponse.json({ error: 'Failed to verify 2FA' }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/2fa
 * Disable 2FA (requires current TOTP code for security).
 * Body: { code: "123456" }
 */
export const DELETE = withAdmin(
  'admin/2fa',
  async (req: NextRequest, ctx) => {
  try {
    const body = await req.json()
    const { code } = body

    const admin = await withNeonRetry(() =>
      db.adminUser.findUnique({
        where: { id: ctx.adminId },
        select: { totpSecret: true, totpEnabled: true },
      })
    )

    if (!admin?.totpEnabled) {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
    }

    const isValid = authenticator.verify({
      token: code,
      secret: admin.totpSecret!,
    })

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid code. Cannot disable 2FA without verification.' }, { status: 400 })
    }

    await withNeonRetry(() =>
      db.adminUser.update({
        where: { id: ctx.adminId },
        data: { totpEnabled: false, totpSecret: null },
      })
    )

    await logAdminAction({
      adminId: ctx.adminId,
      action: '2fa_disabled',
      description: `Disabled 2FA on admin account`,
      targetType: 'admin_user',
      targetId: ctx.adminId,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ success: true, message: '2FA disabled.' })
  } catch (error) {
    console.error('2FA disable error:', error)
    return NextResponse.json({ error: 'Failed to disable 2FA' }, { status: 500 })
  }
},
)
