import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/cron-debug
 * Debug endpoint to check if CRON_SECRET is working.
 * Returns whether the secret is set and whether it matches.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  
  return NextResponse.json({
    cronSecretIsSet: !!cronSecret,
    cronSecretLength: cronSecret ? cronSecret.length : 0,
    cronSecretFirst5: cronSecret ? cronSecret.slice(0, 5) : null,
    authHeaderReceived: !!authHeader,
    authHeaderFirst12: authHeader ? authHeader.slice(0, 12) : null,
    authHeaderLength: authHeader ? authHeader.length : 0,
    match: !!(cronSecret && authHeader === `Bearer ${cronSecret}`),
  })
}
