import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import {
  ROUTE_POLICY,
  WITHDRAWN_CAPABILITIES,
  isRoleAllowed,
  buildProcessingRegister,
  type AdminRole,
  type HttpMethod,
} from '../src/lib/route-policy'

/**
 * The guard that makes the route policy unable to drift from the filesystem.
 *
 * WHY (audit 2026-07-26): authorisation lived in a hardcoded prefix list in
 * middleware.ts. Two entries pointed at routes that had been renamed or never
 * existed — '/api/admin/coupons' and '/api/admin/feature-flags' (the real path
 * is '/api/admin/features'). Those guards matched nothing, so a read-only
 * "viewer" could toggle the global feature kill-switches for the entire
 * shopkeeper app. Nothing detected it because nothing compared the list to
 * reality.
 *
 * This test walks the actual route files. Rename a route and CI fails until
 * the policy is updated.
 */

const API_ROOT = join(__dirname, '..', 'src', 'app', 'api')

function findRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) findRouteFiles(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** src/app/api/admin/users/[id]/route.ts -> "admin/users/[id]" */
function routeKeyFor(file: string): string {
  return relative(API_ROOT, file)
    .split(sep)
    .slice(0, -1)
    .join('/')
}

const routeFiles = findRouteFiles(API_ROOT)

/** Public routes deliberately outside the policy register. */
const UNPOLICED = new Set(['status'])

describe('route policy register', () => {
  it('finds the route files at all (guards against a broken walker)', () => {
    // If this walker silently found nothing, every assertion below would
    // vacuously pass — the classic way a guard test stops guarding.
    expect(routeFiles.length).toBeGreaterThan(50)
  })

  it('has a policy entry for every route file', () => {
    const missing = routeFiles
      .map(routeKeyFor)
      .filter((key) => !UNPOLICED.has(key) && !ROUTE_POLICY[key])
    expect(
      missing,
      `Routes with no entry in ROUTE_POLICY. Add them to src/lib/route-policy.ts — ` +
        `including a one-sentence \`purpose\`. If you cannot state the purpose, ` +
        `do not ship the route.\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  it('has no policy entries for routes that do not exist', () => {
    // This is the exact failure that produced the privilege-escalation bug:
    // a guard naming a path that had been renamed away.
    const actual = new Set(routeFiles.map(routeKeyFor))
    const orphaned = Object.keys(ROUTE_POLICY).filter((key) => !actual.has(key))
    expect(
      orphaned,
      `ROUTE_POLICY names routes with no route.ts file. These guards protect ` +
        `nothing:\n  ${orphaned.join('\n  ')}`,
    ).toEqual([])
  })

  it('declares every HTTP method each route actually exports', () => {
    const problems: string[] = []
    for (const file of routeFiles) {
      const key = routeKeyFor(file)
      const policy = ROUTE_POLICY[key]
      if (!policy) continue
      const src = readFileSync(file, 'utf8')
      const exported = (
        src.match(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g) ?? []
      ).map((m) => m.split(/\s+/).pop() as HttpMethod)

      for (const method of exported) {
        if (policy[method] === undefined) {
          problems.push(`${key} exports ${method} but the policy does not declare it (=> denied)`)
        }
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('requires a non-empty purpose and lawful basis for every route', () => {
    const bad = Object.entries(ROUTE_POLICY)
      .filter(([, p]) => !p.purpose?.trim() || !p.lawfulBasis?.trim())
      .map(([k]) => k)
    expect(bad, `Routes missing purpose or lawfulBasis: ${bad.join(', ')}`).toEqual([])
  })
})

describe('role enforcement', () => {
  const NON_FOUNDER: AdminRole[] = ['viewer', 'support', 'analyst', 'finance']

  it('founder is permitted everywhere', () => {
    for (const [, policy] of Object.entries(ROUTE_POLICY)) {
      expect(isRoleAllowed(policy, 'GET', 'founder')).toBe(true)
      expect(isRoleAllowed(policy, 'DELETE', 'founder')).toBe(true)
    }
  })

  it('denies a method the policy does not declare', () => {
    // Fail closed: an undeclared method is denied, not allowed by omission.
    const policy = ROUTE_POLICY['admin/users']
    expect(policy.DELETE).toBeUndefined()
    expect(isRoleAllowed(policy, 'DELETE', 'support')).toBe(false)
  })

  it('denies every non-founder role when the allow-list is empty', () => {
    const policy = ROUTE_POLICY['admin/database/query']
    for (const role of NON_FOUNDER) {
      expect(isRoleAllowed(policy, 'POST', role)).toBe(false)
    }
  })

  it('denies an absent role', () => {
    expect(isRoleAllowed(ROUTE_POLICY['admin/users'], 'GET', undefined)).toBe(false)
  })

  it('THE ESCALATION BUG: a viewer cannot toggle feature flags', () => {
    // middleware.ts guarded "/api/admin/feature-flags"; the real route is
    // "/api/admin/features". The guard matched nothing and any logged-in
    // account could flip a global kill-switch for the shopkeeper app.
    const policy = ROUTE_POLICY['admin/features/[key]']
    for (const role of NON_FOUNDER) {
      expect(
        isRoleAllowed(policy, 'PATCH', role),
        `role "${role}" must not be able to toggle a global feature flag`,
      ).toBe(false)
    }
    expect(isRoleAllowed(policy, 'PATCH', 'founder')).toBe(true)
  })

  it('a viewer mutates nothing except their own account record', () => {
    // The ONLY sanctioned exception is a selfScoped route — managing your own
    // second factor. Without it, mandatory 2FA would lock a viewer out forever.
    // Every other viewer mutation is a privilege-escalation bug.
    const mutations: HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']
    const violations: string[] = []
    for (const [key, policy] of Object.entries(ROUTE_POLICY)) {
      if (policy.selfScoped) continue
      for (const method of mutations) {
        if (isRoleAllowed(policy, method, 'viewer')) {
          violations.push(`viewer can ${method} ${key}`)
        }
      }
    }
    expect(violations, violations.join('\n  ')).toEqual([])
  })

  it('only genuinely self-scoped routes claim the selfScoped exemption', () => {
    // Guards the escape hatch itself: selfScoped must not become a way to
    // quietly grant viewers write access to other people's data.
    const selfScoped = Object.entries(ROUTE_POLICY)
      .filter(([, p]) => p.selfScoped)
      .map(([k]) => k)
    expect(selfScoped).toEqual(['admin/2fa'])
  })

  it('finance cannot reach the shopkeeper ledger, support cannot reach money', () => {
    // The reason roles are not a linear hierarchy: each needs a different slice.
    expect(isRoleAllowed(ROUTE_POLICY['admin/database/query'], 'POST', 'finance')).toBe(false)
    expect(isRoleAllowed(ROUTE_POLICY['admin/financial-reports'], 'GET', 'support')).toBe(false)
  })
})

describe('withdrawn capabilities', () => {
  it('records why account-aggregator was removed, in enough detail to prevent a rebuild', () => {
    const w = WITHDRAWN_CAPABILITIES['admin/account-aggregator']
    expect(w).toBeDefined()
    // The specific reason matters: "we deleted it" invites someone to add it back.
    expect(w.reason).toMatch(/RBI|SEBI|IRDAI|PFRDA/)
    expect(w.reason).toMatch(/consent/i)
    expect(w.rebuildableIf).toBeTruthy()
  })

  it('records why supplier-intelligence was removed', () => {
    const w = WITHDRAWN_CAPABILITIES['admin/supplier-intelligence']
    expect(w).toBeDefined()
    expect(w.reason).toMatch(/new purpose/i)
    expect(w.rebuildableIf).toMatch(/k-anonymity/i)
  })

  it('no withdrawn capability has come back as a live route', () => {
    // The real risk is not the deletion — it is the quiet re-addition six
    // months later by someone who sees a gap in the product.
    const live = new Set(routeFiles.map(routeKeyFor))
    for (const key of Object.keys(WITHDRAWN_CAPABILITIES)) {
      expect(
        live.has(key),
        `${key} was withdrawn for legal reasons but a route file exists again. ` +
          `See WITHDRAWN_CAPABILITIES in src/lib/route-policy.ts before restoring it.`,
      ).toBe(false)
      expect(ROUTE_POLICY[key], `${key} is withdrawn and must not have a policy entry`).toBeUndefined()
    }
  })

  it('any route still marked verdict:remove grants access to nobody', () => {
    for (const [key, p] of Object.entries(ROUTE_POLICY)) {
      if (p.verdict !== 'remove') continue
      for (const role of ['viewer', 'support', 'analyst', 'finance'] as AdminRole[]) {
        for (const m of ['GET', 'POST', 'PATCH', 'DELETE'] as HttpMethod[]) {
          expect(isRoleAllowed(p, m, role), `${role} still reaches removed route ${key}`).toBe(false)
        }
      }
    }
  })
})

describe('DPDP processing register', () => {
  it('is derivable from code, and every entry is documented', () => {
    const register = buildProcessingRegister()
    expect(register.length).toBe(Object.keys(ROUTE_POLICY).length)
    for (const entry of register) {
      expect(entry.purpose.length).toBeGreaterThan(10)
      expect(entry.lawfulBasis.length).toBeGreaterThan(10)
    }
  })

  it('every route touching third-party ledger data is restricted to founder or a named role', () => {
    // third-party = the shopkeeper's books, containing THEIR customers' and
    // suppliers' data. Nothing here may be open to a general viewer.
    for (const [key, p] of Object.entries(ROUTE_POLICY)) {
      if (p.pii !== 'third-party') continue
      for (const m of ['GET', 'POST', 'PATCH', 'DELETE'] as HttpMethod[]) {
        expect(
          isRoleAllowed(p, m, 'viewer'),
          `viewer must not reach third-party ledger data at ${key}`,
        ).toBe(false)
      }
    }
  })
})
