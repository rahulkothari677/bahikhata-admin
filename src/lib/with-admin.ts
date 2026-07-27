import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID, timingSafeEqual } from 'crypto'
import { authOptions } from './auth'
import { db } from './db'
import { logAdminAction } from './audit'
import { PageTooDeepError } from './pagination'
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
  }) => Promise<unknown>

  /**
   * Marks a query's fallback value as NOT REAL, for use in `.catch(...)`:
   *
   *     db.fraudAlert.count().catch(ctx.degrade('fraudCount', 0))
   *
   * The fallback is still returned, so one broken widget does not blank the
   * page. But withAdmin injects `degraded: [...]` into the JSON response, so
   * the UI can render "—" instead of a confident zero.
   *
   * WHY (audit 2026-07-27): ~290 sites did `.catch(() => 0)`, which makes a
   * FAILURE indistinguishable from a FACT. "0 fraud alerts" read identically
   * whether the query succeeded or timed out.
   *
   * Collected by the wrapper rather than assembled per route, so adopting it
   * is a one-token change at the call site and no route has to remember to
   * merge the report into its own response.
   */
  degrade: <T>(section: string, fallback: T) => (err: unknown) => T
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
            // A cron run has no UI to warn, so a degraded section is logged
            // loudly instead — a nightly job silently computing from partial
            // data is how a wrong number becomes a stored fact.
            degrade:
              <T,>(section: string, fallback: T) =>
              (err: unknown): T => {
                console.error(`[degraded/cron] ${routeKey}/${section} (${requestId}):`, err)
                return fallback
              },
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
    //
    // 🐛 FIX (audit 2026-07-27): this call sits OUTSIDE the try block below,
    // so when the database was unreachable the Prisma error escaped `wrapped`
    // entirely. The caller got a bare 500 with an EMPTY body — no code, no
    // message, no requestId — while every other failure path in this file
    // returns a typed shape. Found by stopping the database and watching what
    // came back: `status 500` and nothing else.
    //
    // It must also fail CLOSED. If we cannot read the operator's current role,
    // we cannot know what they are allowed to do, so the request is refused
    // rather than served on the strength of a JWT claim.
    let admin: Awaited<ReturnType<typeof loadAdmin>>
    try {
      admin = await loadAdmin(adminId)
    } catch (err) {
      console.error(`[with-admin] role re-check failed (${requestId}):`, err)
      return fail(
        503,
        'AUTH_UNAVAILABLE',
        'Cannot verify your access right now. Please retry shortly.',
        requestId,
      )
    }
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

    const degradedSections: string[] = []

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
      degrade:
        <T,>(section: string, fallback: T) =>
        (err: unknown): T => {
          degradedSections.push(section)
          console.error(`[degraded] ${routeKey}/${section} (${requestId}):`, err)
          return fallback
        },
    }

    try {
      const res = await handler(req, ctx, routeParams)
      res.headers.set('x-request-id', requestId)
      // Admin responses carry personal and financial data. Never cacheable.
      res.headers.set('Cache-Control', 'no-store')

      // Inject the degradation report so no route has to remember to merge it.
      // Only for successful JSON responses — a 4xx/5xx already says something
      // went wrong, and streamed bodies must not be buffered to rewrite them.
      if (degradedSections.length > 0 && res.ok) {
        const contentType = res.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          try {
            const body = await res.clone().json()
            const withReport = NextResponse.json(
              { ...body, degraded: degradedSections, isDegraded: true },
              { status: res.status },
            )
            res.headers.forEach((v, k) => withReport.headers.set(k, v))
            return withReport
          } catch {
            // Body was not parseable JSON after all — return it untouched
            // rather than losing the response to a reporting nicety.
          }
        }
      }
      return res
    } catch (err) {
      // A page-depth refusal is the caller's mistake, not a server fault, and
      // the message tells them what to do instead. Surfacing it as a generic
      // 500 would send an operator hunting a bug that does not exist.
      if (err instanceof PageTooDeepError) {
        return fail(400, 'PAGE_TOO_DEEP', err.message, requestId)
      }
      // Log the detail; return none of it.
      console.error(`[with-admin] ${routeKey} ${method} failed (${requestId}):`, err)
      return fail(500, 'INTERNAL_ERROR', 'Something went wrong.', requestId)
    }
  }
}
