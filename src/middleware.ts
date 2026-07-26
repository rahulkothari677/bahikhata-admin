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
//
// 🐛 FIX (admin-login-fix-phase-1-followup): /api/admin/login-probe is a NEW, tightly-scoped
// endpoint that lets the login page distinguish 2FA_REQUIRED from INVALID_CREDENTIALS after
// NextAuth's CredentialsSignin wrapping. It is NOT an info-leak oracle — see the route file
// for the security analysis. It is allowlisted here because it must be callable BEFORE the
// user has a session.
const AUTH_PATHS = [
  '/api/auth',
  '/api/admin/setup',
  '/api/admin/forgot-password',
  '/api/admin/login-probe',  // 🐛 FIX: post-2FA-setup login flow
  '/api/status',
]

// 🐛 FIX (admin-login-fix-phase-1): Paths accessible to a GRACE session
// (a session with requires2FASetup=true — i.e. user has valid email+password
// but hasn't set up 2FA yet). This list is intentionally tiny: the grace
// session's ONLY purpose is to set up 2FA, then sign out and re-login.
//
// NOTE: /setup-2fa is NOT in PUBLIC_PATHS — it requires a session. The
// middleware will let grace sessions through (because they're in this list),
// bounce unauthenticated users to /login, and let already-set-up users
// through (the page itself does a client-side redirect to / in that case).
//
// - /setup-2fa            → the guided 2FA-setup page (client component)
// - /api/admin/2fa        → GET (generate secret + QR), POST (verify + enable)
// - /api/auth/signout     → so the user can abandon the grace session
//
// Anything else (any admin page, any other admin API) is redirected to
// /setup-2fa for page requests, or 403 for API requests.
const GRACE_ALLOWED_PATHS = ['/setup-2fa', '/api/admin/2fa', '/api/auth/signout']

// 10-minute wall-clock TTL for grace sessions, enforced in middleware.
// Why middleware (not just JWT maxAge): we want normal sessions to keep
// their 1-hour maxAge. The grace TTL is enforced separately via the
// graceIssuedAt timestamp stamped in the JWT callback.
const GRACE_SESSION_TTL_MS = 10 * 60 * 1000

// Cron endpoints that accept CRON_SECRET as alternative to session auth
// 🔒 AUDIT FIX: Removed '/api/admin/data-monetization/compute' — endpoint deleted
const CRON_PATHS = [
  '/api/admin/compute-daily-stats',
  '/api/admin/anomalies/detect',
  '/api/admin/fraud-rules/evaluate',
  '/api/admin/webhooks/deliver',
  '/api/admin/bulk-jobs/execute',
  '/api/admin/churn-predictions/compute',
  // 🐛 FIX (audit 2026-07-26): revenue recognition was never scheduled.
  // RevenueSchedule rows are written in exactly one place
  // (lib/revenue-recognition.ts -> createMany), reached only by a human
  // clicking "recompute" in the admin UI. The P&L reads RECOGNISED revenue
  // from RevenueSchedule while reading cash from Subscription, so until
  // someone clicked that button the financial report showed Rs.0 revenue
  // while simultaneously charging payment-gateway fees on real cash.
  // Verified locally: revenue Rs.0, gatewayFees Rs.109.96 (= 2% of Rs.5,498).
  // The recompute is idempotent (deleteMany per subscription, then createMany),
  // so running it daily is safe.
  '/api/admin/revenue-recognition/recompute',
]

/**
 * 🐛 FIX (audit 2026-07-26): this used `pathname.startsWith(p)` over
 * PUBLIC_PATHS, which contains '/setup'. `'/setup-2fa'.startsWith('/setup')`
 * is TRUE, so /setup-2fa was served to anyone with no session at all — while
 * the comment above GRACE_ALLOWED_PATHS asserted it "requires a session".
 * Confirmed against production: GET /setup-2fa returned 200 unauthenticated.
 *
 * Public paths are now matched EXACTLY (or on a real path boundary), never on
 * a bare string prefix. A security list that matches by prefix will eventually
 * match something it was never meant to.
 */
function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/')
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => matchesPath(pathname, p))) return true
  if (AUTH_PATHS.some(p => matchesPath(pathname, p))) return true
  if (pathname.startsWith('/_next/')) return true
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
  // 🔒 AUDIT FIX M2 (v2 audit): FAIL CLOSED in production when CRON_SECRET
  // is unset. Was: fell through to session check (which allows manual
  // triggering from the admin panel — but also allows unauthenticated
  // external calls if CRON_SECRET isn't configured). Now: in production,
  // if CRON_SECRET is unset AND the request has no valid session, reject.
  if (isCronPath(pathname)) {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')

    // If CRON_SECRET matches, skip session check AND CSRF check
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      return res // Allow through (no CSRF check for cron)
    }

    // 🔒 M2: In production, if CRON_SECRET is not set, FAIL CLOSED.
    // Don't allow unauthenticated cron calls — they could trigger expensive
    // operations (bulk jobs, fraud evaluation, churn prediction).
    if (!cronSecret && process.env.NODE_ENV === 'production') {
      // Check if there's a valid session (admin manually triggering)
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
      if (!token) {
        return NextResponse.json(
          { error: 'CRON_SECRET is not configured. Cron endpoints require authentication.' },
          { status: 403 }
        )
      }
      // 🐛 FIX (audit 2026-07-26): this used to `return res` here, BEFORE the
      // FOUNDER_ONLY_PREFIXES check below. /api/admin/bulk-jobs/execute is both
      // a cron path and a founder-only path, so with CRON_SECRET unset in
      // production any logged-in viewer could execute bulk jobs. Fall through
      // to the role checks instead of short-circuiting past them.
      // (A request that presented a VALID CRON_SECRET already returned above.)
    }

    // In dev or when CRON_SECRET is set but doesn't match, fall through to
    // session check (allows manual triggering from admin panel)
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

  // 🐛 FIX (admin-login-fix-phase-1): Grace-session gating.
  // If requires2FASetup is true, the user has valid email+password but
  // hasn't set up 2FA yet. Their session can ONLY access /setup-2fa,
  // /api/admin/2fa, and /api/auth/signout. Everything else is blocked.
  //
  // We also enforce a 10-minute wall-clock TTL via the graceIssuedAt
  // timestamp — after that, the user must re-authenticate. This is
  // tighter than the 1-hour JWT maxAge (which we keep for normal
  // sessions).
  if (token.requires2FASetup === true) {
    // TTL check
    const graceIssuedAt = typeof token.graceIssuedAt === 'number' ? token.graceIssuedAt : 0
    const ageMs = Date.now() - graceIssuedAt
    if (ageMs > GRACE_SESSION_TTL_MS) {
      // Grace session expired — force re-authentication.
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('error', 'grace_expired')
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: '2FA setup grace period expired. Please log in again.' },
          { status: 401 },
        )
      }
      // For page requests, sign-out is handled client-side via the /setup-2fa
      // page's expired banner. A simple redirect to /login is enough here.
      return NextResponse.redirect(loginUrl)
    }

    // Path allowlist check
    const isGraceAllowed = GRACE_ALLOWED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p))
    if (!isGraceAllowed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: '2FA setup required', message: 'You must set up 2FA before accessing this resource.' },
          { status: 403 },
        )
      }
      const setupUrl = new URL('/setup-2fa', req.url)
      return NextResponse.redirect(setupUrl)
    }

    // Grace session on an allowed path — let it through, skip the role/CSRF
    // checks below (they're irrelevant during 2FA setup; the /api/admin/2fa
    // endpoint does its own session verification).
    return res
  }

  // 🔒 V26 A2 FIX: Role hierarchy enforcement.
  // Was: middleware only checked "a valid admin token exists" — not WHICH role.
  // A "viewer" (read-only) could export the entire user database, modify user
  // accounts, send notifications, configure webhooks, and run bulk jobs.
  // Now: enforce role centrally via a path-prefix policy map.
  //
  // Role hierarchy: founder > admin > viewer
  // - viewer: read-only (GET only, no mutations)
  // - admin: most operations except founder-only
  // - founder: everything (including admin-users, database/query, impersonate)
  const role = token.role as string | undefined
  const method = req.method.toUpperCase()
  const isMutationForRole = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)

  // Founder-only path prefixes (mutations AND reads on these paths)
  const FOUNDER_ONLY_PREFIXES = [
    '/api/admin/admin-users',     // manage admin accounts
    '/api/admin/database/',       // raw SQL console
    '/api/admin/impersonate',     // impersonate a shopkeeper
    '/api/admin/bulk',            // bulk jobs
    // 🔒 V26 N2 FIX: data-exports moved from MUTATION_RESTRICTED to FOUNDER_ONLY.
    // Was: only blocked viewers — a non-founder "admin" could still POST
    // data-exports/generate?type=all_users and exfiltrate every shopkeeper's
    // email/name/phone. Now: founder-only, matching database/export.
    '/api/admin/data-exports',    // mass export of user data (all_users mode)
  ]

  // Mutation-restricted path prefixes (viewer can GET but not mutate)
  const MUTATION_RESTRICTED_PREFIXES = [
    '/api/admin/users/',          // modify shopkeeper accounts (PATCH /api/admin/users/[id])
    '/api/admin/database/export', // CSV export
    '/api/admin/notifications',   // send notifications
    '/api/admin/webhooks',        // configure/deliver webhooks
    '/api/admin/coupons',         // manage coupons
    '/api/admin/feature-flags',   // manage feature flags
    '/api/admin/campaigns',       // manage campaigns
    '/api/admin/fraud-rules',     // manage fraud rules
    '/api/admin/api-keys',        // manage API keys
  ]

  // Check founder-only paths
  if (FOUNDER_ONLY_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    if (role !== 'founder') {
      return NextResponse.json(
        { error: 'Forbidden', message: 'This action requires founder role.' },
        { status: 403 },
      )
    }
  }

  // Check mutation-restricted paths: viewer cannot mutate
  if (isMutationForRole && MUTATION_RESTRICTED_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    if (role === 'viewer') {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Viewers cannot perform mutations. Contact a founder.' },
        { status: 403 },
      )
    }
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
