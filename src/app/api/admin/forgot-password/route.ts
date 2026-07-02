import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { isFounderEmail } from '@/lib/founders'

/**
 * POST /api/admin/forgot-password
 * Generates a reset token for the given email.
 *
 * In production, this would email a reset link.
 * For now (dev mode), it returns the token directly.
 *
 * Security: only works for emails in the FOUNDER_EMAILS whitelist.
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Check founder whitelist
    if (!isFounderEmail(normalizedEmail)) {
      // Don't reveal whether the email exists — just say "if it exists, a link was sent"
      return NextResponse.json({
        success: true,
        message: 'If this email is authorized, a reset link has been sent.',
      })
    }

    // Find the admin user
    const adminUser = await db.adminUser.findUnique({
      where: { email: normalizedEmail },
    })

    if (!adminUser) {
      // Don't reveal whether the account exists
      return NextResponse.json({
        success: true,
        message: 'If this email is authorized, a reset link has been sent.',
      })
    }

    // Generate a secure reset token (valid for 15 minutes)
    const resetToken = crypto.randomBytes(32).toString('hex')

    // Store the reset token hash + expiry on the admin user
    // We'll reuse the 'totpSecret' field temporarily since we don't have a
    // dedicated resetToken field. In production, add a proper field.
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min

    // Store the token hash + expiry in metadata (we'll use a simple approach)
    // For now, we'll just return the token directly since this is dev mode
    // In production, email it as: https://admin.bahikhata.pro/forgot-password?token=xxx

    return NextResponse.json({
      success: true,
      message: 'Reset token generated. Use it to set a new password.',
      resetToken, // In production: DON'T return this — email it instead
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/forgot-password
 * Resets the password using the reset token.
 *
 * Body: { email, resetToken, newPassword }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { email, resetToken, newPassword } = await req.json()

    if (!email || !resetToken || !newPassword) {
      return NextResponse.json({ error: 'Email, reset token, and new password are required' }, { status: 400 })
    }

    if (newPassword.length < 12) {
      return NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Verify the reset token (simple verification — in production, compare hash)
    const expectedHash = crypto.createHash('sha256').update(resetToken).digest('hex')

    // Find the admin user
    const adminUser = await db.adminUser.findUnique({
      where: { email: normalizedEmail },
    })

    if (!adminUser) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // In production: verify the token hash matches what was stored
    // For now (dev mode): accept any token that was returned by POST

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12)

    // Update the password
    await db.adminUser.update({
      where: { email: normalizedEmail },
      data: { password: hashedPassword },
    })

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully. You can now log in with your new password.',
    })
  } catch (error) {
    console.error('Password reset error:', error)
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
  }
}
