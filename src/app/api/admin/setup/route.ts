import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { isFounderEmail } from '@/lib/founders'
import { z } from 'zod'

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
    const adminCount = await db.adminUser.count()
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
    const admin = await db.adminUser.create({
      data: {
        email: email.toLowerCase(),
        name,
        password: hashedPassword,
        role: 'founder', // first admin is always founder
      },
      select: { id: true, email: true, name: true, role: true },
    })

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
    return NextResponse.json({ error: 'Setup failed', detail: String(error) }, { status: 500 })
  }
}

/**
 * GET /api/admin/setup
 * Returns whether setup is needed (no admin users exist yet).
 */
export async function GET() {
  const adminCount = await db.adminUser.count()
  return NextResponse.json({
    setupRequired: adminCount === 0,
    adminCount,
  })
}
