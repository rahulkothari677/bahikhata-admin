import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { authenticator } from 'otplib'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/2fa
 * Returns 2FA status + generates a new secret + QR code if not enabled.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = await db.adminUser.findUnique({
      where: { id: (session.user as any).id },
      select: { totpEnabled: true, totpSecret: true, email: true },
    })

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
    await db.adminUser.update({
      where: { id: (session.user as any).id },
      data: { totpSecret: secret },
    })

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
}

/**
 * POST /api/admin/2fa
 * Verify the TOTP code and enable 2FA.
 * Body: { code: "123456" }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { code } = body

    if (!code || code.length !== 6) {
      return NextResponse.json({ error: 'Invalid code. Enter the 6-digit code from your authenticator app.' }, { status: 400 })
    }

    const admin = await db.adminUser.findUnique({
      where: { id: (session.user as any).id },
      select: { totpSecret: true, totpEnabled: true, email: true },
    })

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
    await db.adminUser.update({
      where: { id: (session.user as any).id },
      data: { totpEnabled: true },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: '2fa_enabled',
      description: `Enabled 2FA on admin account`,
      targetType: 'admin_user',
      targetId: (session.user as any).id,
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
}

/**
 * DELETE /api/admin/2fa
 * Disable 2FA (requires current TOTP code for security).
 * Body: { code: "123456" }
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { code } = body

    const admin = await db.adminUser.findUnique({
      where: { id: (session.user as any).id },
      select: { totpSecret: true, totpEnabled: true },
    })

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

    await db.adminUser.update({
      where: { id: (session.user as any).id },
      data: { totpEnabled: false, totpSecret: null },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: '2fa_disabled',
      description: `Disabled 2FA on admin account`,
      targetType: 'admin_user',
      targetId: (session.user as any).id,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ success: true, message: '2FA disabled.' })
  } catch (error) {
    console.error('2FA disable error:', error)
    return NextResponse.json({ error: 'Failed to disable 2FA' }, { status: 500 })
  }
}
