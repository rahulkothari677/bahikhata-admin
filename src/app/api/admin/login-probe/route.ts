import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { isFounderEmail } from '@/lib/founders'
import { checkAdminLoginRate } from '@/lib/admin-rate-limit'
import { withNeonRetry } from '@/lib/resilience'

/**
 * POST /api/admin/login-probe
 *
 * 🐛 FIX (admin-login-fix-phase-1-followup): NextAuth's CredentialsProvider
 * wraps ALL thrown errors from authorize() into a single `CredentialsSignin`
 * type when `signIn({ redirect: false })` is used. The actual error message
 * (e.g. "2FA_REQUIRED", "Rate limit exceeded") is NOT exposed to the client.
 *
 * This means the login page cannot distinguish between:
 *   - Wrong password (true invalid credentials)
 *   - 2FA required (user needs to enter TOTP code)
 *   - Rate-limited (too many attempts)
 *   - Email not in founder whitelist
 *
 * Without a way to tell these apart, after a user sets up 2FA and tries to
 * log in again, the login page shows "Invalid email or password" instead
 * of showing the 2FA code input — the user is locked out AGAIN.
 *
 * This endpoint is the secure fix. It does the SAME checks as authorize()
 * but returns a structured reason. The key security property: it ONLY
 * returns `2FA_REQUIRED` after the user has PROVEN they know the email +
 * password combination. So an attacker CANNOT use this endpoint to:
 *   - Enumerate which emails have admin accounts (returns INVALID_CREDENTIALS
 *     for both "email not in whitelist" and "wrong password")
 *   - Learn whether 2FA is enabled for a specific email (only returns
 *     2FA_REQUIRED after the password is verified)
 *
 * Rate limiting is shared with the main login flow (same Redis counter),
 * so this endpoint inherits the same 5-per-15-min-per-email+IP cap.
 *
 * Responses (always 200 OK with a `reason` field, except for rate-limit):
 *   - { reason: '2FA_REQUIRED' }                     ← email+password OK, needs TOTP
 *   - { reason: 'INVALID_CREDENTIALS' }              ← wrong password OR not in whitelist
 *   - { reason: 'RATE_LIMITED', retryAfterSec: N }   ← too many attempts (HTTP 429)
 *   - { reason: 'OK' }                                ← email+password+TOTP all OK (not used here)
 *
 * The login page calls this ONLY after `signIn()` returns CredentialsSignin.
 * It uses the response to decide: show 2FA input (reason=2FA_REQUIRED) or
 * show generic error (any other reason).
 */

const ProbeSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    // 🔒 CSRF / same-origin check. This endpoint is in AUTH_PATHS so the
    // middleware's CSRF check is skipped. We do it manually here:
    //   - For browser-submitted forms, Origin or Referer MUST be present
    //     and match the host.
    //   - For same-origin fetch from the login page, Origin/Referer will
    //     match. If neither header is present, reject.
    const origin = req.headers.get('origin')
    const referer = req.headers.get('referer')
    const host = req.headers.get('host')
    if (!origin && !referer) {
      return NextResponse.json(
        { reason: 'INVALID_CREDENTIALS', error: 'Missing Origin/Referer' },
        { status: 403 },
      )
    }
    const sourceUrl = origin || referer
    if (sourceUrl && host) {
      try {
        const sourceHost = new URL(sourceUrl).host
        if (sourceHost !== host) {
          return NextResponse.json(
            { reason: 'INVALID_CREDENTIALS', error: 'Cross-origin blocked' },
            { status: 403 },
          )
        }
      } catch {
        return NextResponse.json(
          { reason: 'INVALID_CREDENTIALS', error: 'Invalid Origin/Referer' },
          { status: 403 },
        )
      }
    }

    const body = await req.json()
    const parsed = ProbeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { reason: 'INVALID_CREDENTIALS' },
        { status: 200 },
      )
    }

    const email = parsed.data.email.trim().toLowerCase()
    const password = parsed.data.password

    // IP for rate-limit accounting (shared with main login flow).
    const forwarded = req.headers.get('x-forwarded-for')
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || 'unknown'

    // Shared rate limit — calling this endpoint counts against the same
    // 5-per-15-min-per-email+IP cap as a regular login attempt. This
    // prevents brute-force via this endpoint.
    const rateCheck = await checkAdminLoginRate(email, ip)
    if (!rateCheck.success) {
      return NextResponse.json(
        {
          reason: 'RATE_LIMITED',
          retryAfterSec: rateCheck.retryAfterSec,
          message: `Too many login attempts. Please wait ${Math.ceil(rateCheck.retryAfterSec / 60)} minutes.`,
        },
        { status: 429 },
      )
    }

    // Step 1: Check if email is in founder whitelist. If not, return
    // INVALID_CREDENTIALS (don't reveal whether the email exists).
    if (!isFounderEmail(email)) {
      return NextResponse.json({ reason: 'INVALID_CREDENTIALS' }, { status: 200 })
    }

    // Step 2: Find admin user.
    // 🐛 FIX (admin-login-fix-phase-1-followup-2): wrap with withNeonRetry
    // so Neon cold-start doesn't surface as a raw Prisma error.
    const adminUser = await withNeonRetry(() =>
      db.adminUser.findUnique({
        where: { email },
        select: {
          id: true,
          password: true,
          isActive: true,
          totpEnabled: true,
          totpSecret: true,
        },
      })
    )

    // Step 3: Verify password. If user doesn't exist OR password is wrong,
    // return INVALID_CREDENTIALS (same response — no enumeration).
    if (!adminUser || !adminUser.isActive) {
      return NextResponse.json({ reason: 'INVALID_CREDENTIALS' }, { status: 200 })
    }

    const passwordValid = await bcrypt.compare(password, adminUser.password)
    if (!passwordValid) {
      return NextResponse.json({ reason: 'INVALID_CREDENTIALS' }, { status: 200 })
    }

    // Step 4: Password is valid. NOW we can safely tell the client whether
    // 2FA is required. The user has proven they know the credentials.
    if (adminUser.totpEnabled && adminUser.totpSecret) {
      return NextResponse.json({ reason: '2FA_REQUIRED' }, { status: 200 })
    }

    // Step 5: Edge case — password valid but 2FA not set up. This shouldn't
    // happen in the normal flow (grace login handles it), but if it does,
    // signal 2FA_SETUP_REQUIRED so the login page can redirect to /setup-2fa.
    return NextResponse.json({ reason: '2FA_SETUP_REQUIRED' }, { status: 200 })
  } catch (error) {
    console.error('[login-probe] error:', error)

    // 🐛 FIX (admin-login-fix-phase-1-followup-2): If withNeonRetry exhausted
    // its retries (DB still waking up or truly down), return DB_UNAVAILABLE
    // so the login page can show "Service temporarily unavailable" instead
    // of "Invalid email or password" (which would mislead the user into
    // thinking their credentials are wrong).
    const errMsg = error instanceof Error ? error.message : String(error)
    const isDbError =
      errMsg.includes('reach database server') ||
      errMsg.includes('Connection terminated') ||
      errMsg.includes('kind: Close') ||
      errMsg.includes('Connection refused') ||
      errMsg.includes('Query timeout') ||
      errMsg.includes('Timed out fetching')

    if (isDbError) {
      return NextResponse.json(
        {
          reason: 'DB_UNAVAILABLE',
          message: 'Our database is waking up. Please wait 10 seconds and try again.',
        },
        { status: 503 },
      )
    }

    // Don't leak other internal errors — return generic.
    return NextResponse.json(
      { reason: 'INVALID_CREDENTIALS' },
      { status: 200 },
    )
  }
}
