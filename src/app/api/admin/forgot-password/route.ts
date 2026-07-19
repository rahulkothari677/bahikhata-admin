import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { isFounderEmail } from '@/lib/founders'

/**
 * 🔒 V26 N5: Simple IP-based rate limiter for the forgot-password endpoint.
 * Uses the same in-memory fallback pattern as admin-rate-limit.ts.
 * In production with Redis configured, this could use Upstash — for now,
 * the in-memory fallback is sufficient (the endpoint is low-volume + the
 * token is 256-bit validated).
 */
const resetRateBuckets = new Map<string, { count: number; resetAt: number }>()
const RESET_RATE_MAX = 5  // 5 requests per 15 minutes per IP
const RESET_RATE_WINDOW_MS = 15 * 60 * 1000

function checkResetRate(ip: string): { success: boolean; retryAfterSec: number } {
  const now = Date.now()
  let bucket = resetRateBuckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RESET_RATE_WINDOW_MS }
    resetRateBuckets.set(ip, bucket)
  }
  if (bucket.count >= RESET_RATE_MAX) {
    return { success: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  bucket.count++
  return { success: true, retryAfterSec: 0 }
}

function getClientIP(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

/**
 * POST /api/admin/forgot-password
 * Generates a reset token for the given email.
 *
 * 🔒 V26 A1 FIX: Was returning the reset token in the HTTP response AND never
 * storing it. The PATCH endpoint accepted ANY token ("dev mode: accept any
 * token"). Now: stores SHA-256 hash + 15-min expiry in the DB, never returns
 * the token in production, and PATCH validates the hash with timingSafeEqual.
 *
 * 🔒 V26 N5: Added rate limiting (5/15min/IP) for parity with S4.
 *
 * Security: only works for emails in the FOUNDER_EMAILS whitelist.
 */
export async function POST(req: NextRequest) {
  try {
    // 🔒 V26 N5: Rate limit
    const ip = getClientIP(req)
    const rl = checkResetRate(ip)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'Too many reset requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }

    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Check founder whitelist
    if (!isFounderEmail(normalizedEmail)) {
      // Don't reveal whether the email exists
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

    // Store the reset token HASH (not the raw token) + expiry on the admin user
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min

    await db.adminUser.update({
      where: { email: normalizedEmail },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt,
      },
    })

    // 🔒 V26 A1: In production, NEVER return the token — email it instead.
    // In development, return it for testing convenience.
    if (process.env.NODE_ENV === 'production') {
      // TODO: wire Resend (or whatever email provider) to send the reset link:
      //   https://admin.bahikhata.pro/reset-password?token=<resetToken>
      // For now, just log success without returning the token.
      console.log(`[forgot-password] Reset token generated for ${normalizedEmail}. Email sending not yet wired.`)
      return NextResponse.json({
        success: true,
        message: 'If this email is authorized, a reset link has been sent.',
      })
    }

    // Dev mode: return the token for testing
    return NextResponse.json({
      success: true,
      message: 'Reset token generated (dev mode — token returned directly).',
      resetToken,
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
 * 🔒 V26 A1 FIX: Was accepting ANY token without validation ("dev mode:
 * accept any token"). Now: validates the token hash against the stored hash
 * using timingSafeEqual, checks expiry, and single-uses the token (clears
 * it after successful reset).
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

    // Find the admin user
    const adminUser = await db.adminUser.findUnique({
      where: { email: normalizedEmail },
    })

    if (!adminUser) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // 🔒 V26 A1 FIX: Validate the reset token.
    // Was: "For now (dev mode): accept any token" — no validation at all.
    // Now: compare the hash using timingSafeEqual + check expiry + single-use.
    if (!adminUser.passwordResetTokenHash || !adminUser.passwordResetExpiresAt) {
      return NextResponse.json({ error: 'No reset token found. Request a new reset link.' }, { status: 400 })
    }

    // Check expiry
    if (new Date() > adminUser.passwordResetExpiresAt) {
      // Clear the expired token
      await db.adminUser.update({
        where: { id: adminUser.id },
        data: { passwordResetTokenHash: null, passwordResetExpiresAt: null },
      })
      return NextResponse.json({ error: 'Reset token has expired. Request a new reset link.' }, { status: 400 })
    }

    // Compare the token hash using timingSafeEqual (prevents timing attacks)
    const providedHash = crypto.createHash('sha256').update(resetToken).digest('hex')
    const storedHash = adminUser.passwordResetTokenHash

    // timingSafeEqual requires equal-length buffers
    const providedBuffer = Buffer.from(providedHash, 'hex')
    const storedBuffer = Buffer.from(storedHash, 'hex')

    if (providedBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(providedBuffer, storedBuffer)) {
      return NextResponse.json({ error: 'Invalid reset token.' }, { status: 400 })
    }

    // Token is valid — hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12)

    // Update the password AND clear the reset token (single-use)
    await db.adminUser.update({
      where: { id: adminUser.id },
      data: {
        password: hashedPassword,
        passwordResetTokenHash: null,   // single-use: clear after successful reset
        passwordResetExpiresAt: null,
      },
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
