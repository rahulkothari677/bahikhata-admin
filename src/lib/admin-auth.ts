/**
 * 🔒 V8 A3: Defense-in-depth admin auth helper.
 *
 * The admin middleware gates /api/admin/* by email allowlist. This helper
 * adds a SECOND check inside each route handler — so if the middleware
 * matcher ever has a regression, the handler still verifies the session
 * user is actually a founder.
 *
 * Usage:
 *   const auth = await requireAdmin()
 *   if (!auth.ok) return auth.error
 *   // ... handler logic
 */

import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { isFounderEmail } from '@/lib/founders'

export async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return {
      ok: false as const,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const email = (session.user as any)?.email
  if (!email || !isFounderEmail(email)) {
    return {
      ok: false as const,
      error: NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 }),
    }
  }

  return { ok: true as const, session }
}
