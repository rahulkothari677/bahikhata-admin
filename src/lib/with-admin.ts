import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID, timingSafeEqual } from 'crypto'
import { authOptions } from './auth'
import { db } from './db'
import { logAdminAction } from './audit'
import {
  ROUTE_POLICY,
  isRoleAllowed,
  type AdminRole,
  type HttpMethod,
  type RoutePolicy,
} from './route-policy'

/**
 * The single enforcement point for every admin API route.
 *
 * WHY (audit 2026-07-26): all 81 routes called getServerSession() — which only
 * answers "is SOMEONE logged in?" — and delegated the actual authorisation to a
 * hardcoded prefix list in middleware.ts. Two prefixes in that list pointed at
 * routes that had been renamed, so they matched nothing and a read-only viewer
 * could flip global feature kill-switches. Authorisation that lives in a
 * separate file from the route will drift from it.
 *
 * withAdmin() resolves the policy for THIS route and enforces it in the handler
 * itself. Middleware stays as defence in depth; this is the authority.
 *
 * It also closes the revocation gap: `role` used to be read from a 1-hour JWT
 * and never re-checked, so a demoted or deactivated admin kept their old powers
 * until the token expired. The role is now re-read from the database (through a
 * short cache) on every request.
 */

export interface AdminContext {
  adminId: string
  email: string
  role: AdminRole
  requestId: string
  ip?: string
  userAgent?: string
  /** Write an audit entry attributed to this operator. */
  audit: (entry: {
    action: string
    description: string
    targetType?: string
    targetId?: string
    metadata?: unknown
  }) => Promise<void>
}

type Handler = (
  req: NextRequest,
  ctx: AdminContext,
  routeParams: { params: Promise<Record<string, string>> },
) => Promise<NextResponse> | NextResponse

/** Uniform error shape. No raw error strings ever reach a client. */
function fail(
  status: number,
  code: string,
  message: string,
  requestId: string,
): NextResponse {
  const res = NextResponse.json({ error: { code, message, requestId } }, { status })
  res.headers.set('x-request-id', requestId)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/**
 * Short-lived cache of {role, isActive, tokenVersion}. Without this the DB
 * re-check would add a query to every admin request; with it the cost is one
 * query per admin per 30 seconds, and a revocation still takes effect within 30s.
 */
const roleCache = new Map<
  string,
  { role: AdminRole; isActive: boolean; tokenVersion: number; at: number }
>()
const ROLE_CACHE_TTL_MS = 30_000

export function invalidateRoleCache(adminId: string) {
  roleCache.delete(adminId)
}

async function loadAdmin(adminId: string) {
  const cached = roleCache.get(adminId)
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached

  const row = await db.adminUser.findUnique({
    where: { id: adminId },
    select: { role: true, isActive: true, tokenVersion: true },
  })
  if (!row) return null

  const entry = {
    role: row.role as AdminRole,
    isActive: row.isActive,
    tokenVersion: row.tokenVersion,
    at: Date.now(),
  }
  roleCache.set(adminId, entry)
  return entry
}

export function withAdmin(routeKey: string, handler: Handler) {
  return async function wrapped(
    req: NextRequest,
    routeParams: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> {
    const requestId = randomUUID()
    const method = req.method.toUpperCase() as HttpMethod

    const policy: RoutePolicy | undefined = ROUTE_POLICY[routeKey]
    if (!policy) {
      // Fail CLOSED. An unregistered route is a bug, not a free pass.
      console.error(`[with-admin] No policy registered for route "${routeKey}"`)
      return fail(500, 'POLICY_MISSING', 'Route policy not configured.', requestId)
    }

    if (policy.verdict === 'remove') {
      return fail(
        410,
        'ROUTE_REMOVED',
        'This capability has been withdrawn and is no longer available.',
        requestId,
      )
    }

    // ── Cron authentication ───────────────────────────────────────────────
    // Scheduled jobs (GitHub Actions) present a bearer CRON_SECRET instead of
    // a session. Only routes whose policy declares `cron: true` may use it, and
    // the comparison is length-checked + timing-safe: a plain === on a secret
    // leaks its length and content through response timing.
    if (policy.cron) {
      const authHeader = req.headers.get('authorization')
      const cronSecret = process.env.CRON_SECRET
      if (authHeader?.startsWith('Bearer ') && cronSecret) {
        const presented = authHeader.slice(7)
        const a = Buffer.from(presented)
        const b = Buffer.from(cronSecret)
        if (a.length === b.length && timingSafeEqual(a, b)) {
          const cronCtx: AdminContext = {
            adminId: 'system:cron',
            email: 'cron@system',
            role: 'founder',
            requestId,
            audit: (entry) =>
              logAdminAction({
                adminId: 'system:cron',
                action: entry.action,
                description: entry.description,
                targetType: entry.targetType,
                targetId: entry.targetId,
                metadata: { ...(entry.metadata as object), requestId, viaCron: true },
              }),
          }
          try {
            const res = await handler(req, cronCtx, routeParams)
            res.headers.set('x-request-id', requestId)
            res.headers.set('Cache-Control', 'no-store')
            return res
          } catch (err) {
            console.error(`[with-admin/cron] ${routeKey} failed (${requestId}):`, err)
            return fail(500, 'INTERNAL_ERROR', 'Something went wrong.', requestId)
          }
        }
      }
      // Fall through to session auth — a human may also trigger these manually.
    }

    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return fail(401, 'UNAUTHENTICATED', 'Sign in to continue.', requestId)
    }

    const adminId = (session.user as { id?: string }).id
    const email = session.user.email ?? undefined
    if (!adminId || !email) {
      return fail(401, 'UNAUTHENTICATED', 'Sign in to continue.', requestId)
    }

    // A grace session exists only to set up 2FA. It must never reach a route.
    if ((session.user as { requires2FASetup?: boolean }).requires2FASetup) {
      return fail(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Complete 2FA setup first.', requestId)
    }

    // Re-check against the DATABASE, not the JWT. This is what makes
    // deactivating or demoting an admin take effect immediately.
    const admin = await loadAdmin(adminId)
    if (!admin) {
      return fail(401, 'UNAUTHENTICATED', 'Sign in to continue.', requestId)
    }
    if (!admin.isActive) {
      return fail(403, 'ACCOUNT_DISABLED', 'This admin account is disabled.', requestId)
    }
    const jwtTokenVersion = (session.user as { tokenVersion?: number }).tokenVersion ?? 0
    if (jwtTokenVersion !== admin.tokenVersion) {
      return fail(401, 'SESSION_REVOKED', 'Your session has been revoked. Sign in again.', requestId)
    }

    if (!isRoleAllowed(policy, method, admin.role)) {
      // Denied authorisation attempts are themselves security-relevant.
      await logAdminAction({
        adminId,
        action: 'access_denied',
        description: `Denied ${method} ${routeKey} for role "${admin.role}"`,
        targetType: 'route',
        targetId: routeKey,
        metadata: { requestId, method, role: admin.role },
      })
      return fail(
        403,
        'FORBIDDEN',
        `Your role (${admin.role}) cannot perform this action.`,
        requestId,
      )
    }

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      undefined
    const userAgent = req.headers.get('user-agent') || undefined

    const ctx: AdminContext = {
      adminId,
      email,
      role: admin.role,
      requestId,
      ip,
      userAgent,
      audit: (entry) =>
        logAdminAction({
          adminId,
          action: entry.action,
          description: entry.description,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: { ...(entry.metadata as object), requestId },
          ip,
          userAgent,
        }),
    }

    try {
      const res = await handler(req, ctx, routeParams)
      res.headers.set('x-request-id', requestId)
      // Admin responses carry personal and financial data. Never cacheable.
      res.headers.set('Cache-Control', 'no-store')
      return res
    } catch (err) {
      // Log the detail; return none of it.
      console.error(`[with-admin] ${routeKey} ${method} failed (${requestId}):`, err)
      return fail(500, 'INTERNAL_ERROR', 'Something went wrong.', requestId)
    }
  }
}
