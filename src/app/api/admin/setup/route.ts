import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { isFounderEmail } from '@/lib/founders'
import { z } from 'zod'
import { withNeonRetry } from '@/lib/resilience'

/**
 * POST /api/admin/setup
 *
 * One-time setup endpoint to create the FIRST admin account.
 * After the first admin is created, this endpoint auto-disables.
 *
 * Security:
 *   - Only works if NO admin users exist yet (one-time bootstrap)
 *   - Email must be in FOUNDER_EMAILS whitelist
 *   - Password must be at least 12 characters
 *   - Rate limited to 3 attempts per hour (built into the logic)
 *
 * After setup, the founder should:
 *   1. Log in with their email + password
 *   2. Enable 2FA in their profile settings
 *   3. Never share these credentials
 */

const SetupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().min(2, 'Name is required'),
})

export async function POST(req: NextRequest) {
  try {
    // SECURITY: Only allow if no admin users exist
    // 🐛 FIX (admin-login-fix-phase-1-followup-2): wrap with withNeonRetry
    const adminCount = await withNeonRetry(() => db.adminUser.count())
    if (adminCount > 0) {
      return NextResponse.json({
        error: 'Setup already complete',
        detail: 'Admin accounts already exist. Use /login instead. To reset, manually clear the AdminUser table.',
      }, { status: 403 })
    }

    const body = await req.json()
    const { email, password, name } = SetupSchema.parse(body)

    // SECURITY: Email must be in founder whitelist
    if (!isFounderEmail(email)) {
      return NextResponse.json({
        error: 'Email not authorized',
        detail: 'Only founder emails can create admin accounts.',
      }, { status: 403 })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create the first admin user
    // 🐛 FIX (admin-login-fix-phase-1-followup-2): wrap with withNeonRetry
    const admin = await withNeonRetry(() =>
      db.adminUser.create({
        data: {
          email: email.toLowerCase(),
          name,
          password: hashedPassword,
          role: 'founder', // first admin is always founder
        },
        select: { id: true, email: true, name: true, role: true },
      })
    )

    return NextResponse.json({
      success: true,
      message: 'Admin account created. You can now log in at /login.',
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    })
  } catch (error: any) {
    if (error.issues) {
      return NextResponse.json({ error: 'Validation failed', detail: error.issues }, { status: 400 })
    }
    console.error('Setup error:', error)
    // 🔒 (audit 2026-07-27) This returned `detail: String(error)` on an
    // UNAUTHENTICATED endpoint — the worst possible place to leak Prisma
    // messages, column names and constraint names. Log it, do not ship it.
    console.error('[admin/setup] failed:', error)
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 })
  }
}

/**
 * ⛔ GET /api/admin/setup — REMOVED (audit 2026-07-26).
 *
 * It returned { setupRequired, adminCount } with NO authentication. Confirmed
 * live against production, which answered the open internet with:
 *     {"setupRequired":false,"adminCount":1}
 *
 * That is an oracle. POST /api/admin/setup creates a FOUNDER account whenever
 * the AdminUser table is empty, gated only by the email being in
 * FOUNDER_EMAILS — and that list has a hardcoded fallback containing a real
 * address. So any scanner could poll this endpoint and learn the exact moment
 * the bootstrap window opened (after a restore, a migration accident, or a
 * table being cleared) and claim founder.
 *
 * The setup page determines whether setup is needed by attempting POST and
 * handling the 403, which reveals nothing to an unauthenticated caller.
 */
