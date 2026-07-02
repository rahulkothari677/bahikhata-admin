import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { isFounderEmail } from '@/lib/founders'

/**
 * POST /api/admin/login-debug
 *
 * Debug endpoint that tells the user EXACTLY why login failed.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ reason: 'Email and password are required.' })
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Check 1: Founder whitelist
    if (!isFounderEmail(normalizedEmail)) {
      return NextResponse.json({
        reason: `Email "${normalizedEmail}" is not in the FOUNDER_EMAILS whitelist. Add it to the FOUNDER_EMAILS env var in Vercel.`,
      })
    }

    // Check 2: Account exists?
    const adminUser = await db.adminUser.findUnique({
      where: { email: normalizedEmail },
    })

    if (!adminUser) {
      return NextResponse.json({
        reason: `No admin account found for "${normalizedEmail}". Visit /setup to create one.`,
      })
    }

    // Check 3: Active?
    if (!adminUser.isActive) {
      return NextResponse.json({
        reason: `Account is deactivated.`,
      })
    }

    // Check 4: Password correct?
    const passwordValid = await bcrypt.compare(password, adminUser.password)
    if (!passwordValid) {
      return NextResponse.json({
        reason: `Password is incorrect. Use "Forgot password?" to reset.`,
      })
    }

    // Check 5: 2FA?
    if (adminUser.totpEnabled) {
      return NextResponse.json({
        reason: '2FA code required. Enter the 6-digit code from your authenticator app.',
      })
    }

    return NextResponse.json({
      reason: 'All checks passed. If login still fails, clear browser cookies and try again.',
    })
  } catch (error) {
    return NextResponse.json({
      reason: `Server error: ${String(error).slice(0, 200)}`,
    })
  }
}
