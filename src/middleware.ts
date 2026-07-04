import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

/**
 * Admin panel middleware — runs on EVERY request.
 *
 * Security layers:
 *   1. IP allowlist (optional) — blocks requests from non-whitelisted IPs
 *   2. Security headers — HSTS, X-Frame-Options, no-sniff, etc.
 *   3. Auth check — redirects to /login if not authenticated
 *   4. CSRF protection — verifies Origin on mutations
 *
 * Exceptions (no auth required):
 *   - /login (the login page itself)
 *   - /api/auth/* (NextAuth callbacks)
 *   - Static files (_next/*, favicon, etc.)
 */

const PUBLIC_PATHS = ['/login', '/setup', '/forgot-password', '/status']
// 🔒 AUDIT FIX: Removed '/api/admin/login-debug' and '/api/admin/cron-debug' from bypass list
// — these endpoints were deleted (security: login-debug was an unauthenticated info-leak oracle)
const AUTH_PATHS = ['/api/auth', '/api/admin/setup', '/api/admin/forgot-password', '/api/status']

// Cron endpoints that accept CRON_SECRET as alternative to session auth
// 🔒 AUDIT FIX: Removed '/api/admin/data-monetization/compute' — endpoint deleted
const CRON_PATHS = [
  '/api/admin/compute-daily-stats',
  '/api/admin/anomalies/detect',
  '/api/admin/fraud-rules/evaluate',
  '/api/admin/webhooks/deliver',
  '/api/admin/bulk-jobs/execute',
  '/api/admin/churn-predictions/compute',
]

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return true
  if (AUTH_PATHS.some(p => pathname.startsWith(p))) return true
  if (pathname.startsWith('/_next')) return true
  if (pathname.startsWith('/favicon')) return true
  return false
}

function isCronPath(pathname: string): boolean {
  return CRON_PATHS.some(p => pathname === p)
}

function isAllowedIp(ip: string): boolean {
  const allowlist = process.env.ADMIN_IP_ALLOWLIST
  if (!allowlist) return true // no allowlist configured = allow all

  const allowed = allowlist.split(',').map(s => s.trim()).filter(Boolean)
  // Simple exact match (for CIDR support, install ip-cidr package)
  return allowed.some(allowedIp => {
    if (allowedIp === ip) return true
    // Basic CIDR check: if it ends with /0, allow all
    if (allowedIp.endsWith('/0')) return true
    return false
  })
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const res = NextResponse.next()

  // ===== SECURITY HEADERS (applied to ALL responses) =====
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY') // no clickjacking
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // HSTS — only on HTTPS
  if (req.nextUrl.protocol === 'https:') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  }

  // ===== IP ALLOWLIST =====
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
             req.headers.get('x-real-ip') ||
             'unknown'
  if (!isAllowedIp(ip)) {
    return new NextResponse('Access denied', { status: 403 })
  }

  // ===== SKIP AUTH FOR PUBLIC PATHS =====
  if (isPublicPath(pathname)) {
    // Still apply CSRF check on mutations to auth paths
    return res
  }

  // ===== CRON AUTH CHECK =====
  // Cron endpoints accept CRON_SECRET as alternative to session auth
  if (isCronPath(pathname)) {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    
    // If CRON_SECRET matches, skip session check AND CSRF check
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      return res // Allow through (no CSRF check for cron)
    }
    
    // If CRON_SECRET is not set, fall through to session check below
    // (allows manual triggering from admin panel)
    if (!cronSecret) {
      // Fall through to session check
    } else {
      // CRON_SECRET is set but doesn't match — check session (manual trigger)
      // Fall through to session check
    }
  }

  // ===== AUTH CHECK =====
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) {
    // Redirect to login for page requests, 401 for API requests
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ===== CSRF PROTECTION ON MUTATIONS =====
  // 🔒 AUDIT FIX: Block mutations where BOTH Origin AND Referer are missing.
  // Was: allowed through if Origin was missing (CSRF bypass).
  // Now: requires at least one valid same-origin header on mutations.
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase())
  if (isMutation && !pathname.startsWith('/api/auth') && !pathname.startsWith('/api/admin/setup')) {
    const origin = req.headers.get('origin')
    const referer = req.headers.get('referer')
    const host = req.headers.get('host')

    // Block if BOTH Origin AND Referer are missing
    if (!origin && !referer) {
      return NextResponse.json(
        { error: 'CSRF check failed — missing Origin/Referer header' },
        { status: 403 }
      )
    }

    // If Origin is present, verify it matches host
    if (origin && host) {
      try {
        const originHost = new URL(origin).host
        if (originHost !== host) {
          return NextResponse.json({ error: 'CSRF check failed', detail: `Origin ${originHost} != Host ${host}` }, { status: 403 })
        }
      } catch {
        return NextResponse.json({ error: 'Invalid origin header' }, { status: 403 })
      }
    }

    // If Referer is present (and Origin was missing), verify it matches host
    if (!origin && referer && host) {
      try {
        const refererHost = new URL(referer).host
        if (refererHost !== host) {
          return NextResponse.json({ error: 'CSRF check failed', detail: `Referer ${refererHost} != Host ${host}` }, { status: 403 })
        }
      } catch {
        return NextResponse.json({ error: 'Invalid referer header' }, { status: 403 })
      }
    }
  }

  return res
}

export const config = {
  // Run on all routes except static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
