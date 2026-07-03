import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/cron-debug
 * DEBUG endpoint - NO AUTH REQUIRED.
 * Shows whether CRON_SECRET is set and its first 5 chars.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  
  return NextResponse.json({
    message: "Debug endpoint working",
    cronSecretIsSet: !!cronSecret,
    cronSecretLength: cronSecret ? cronSecret.length : 0,
    cronSecretFirst5: cronSecret ? cronSecret.slice(0, 5) : null,
    authHeaderReceived: !!authHeader,
    authHeaderFirst12: authHeader ? authHeader.slice(0, 12) : null,
    authHeaderLength: authHeader ? authHeader.length : 0,
    match: !!(cronSecret && authHeader === `Bearer ${cronSecret}`),
    timestamp: new Date().toISOString(),
  })
}

// Also accept POST (cron sends POST)
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  
  return NextResponse.json({
    message: "Debug POST endpoint working",
    cronSecretIsSet: !!cronSecret,
    cronSecretLength: cronSecret ? cronSecret.length : 0,
    cronSecretFirst5: cronSecret ? cronSecret.slice(0, 5) : null,
    authHeaderReceived: !!authHeader,
    authHeaderFirst12: authHeader ? authHeader.slice(0, 12) : null,
    match: !!(cronSecret && authHeader === `Bearer ${cronSecret}`),
    timestamp: new Date().toISOString(),
  })
}
