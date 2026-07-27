import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * The migration ratchet for withAdmin().
 *
 * ROUTE_POLICY declares who may call what. withAdmin() is what ENFORCES it.
 * A policy without the wrapper is documentation, not a control — so the gap
 * between "routes that exist" and "routes that enforce their policy" is the
 * real remaining exposure, and it must only ever shrink.
 *
 * This test does two things:
 *   1. Caps the number of unmigrated routes. Add a new unwrapped route and CI
 *      fails. Migrate one and the baseline must be lowered in the same commit,
 *      so progress is recorded rather than claimed.
 *   2. Hard-fails if any route on MUST_ENFORCE is unwrapped. These are the
 *      routes where an unauthorised call does real damage: mutations that
 *      change the shopkeeper app's behaviour, and anything touching the ledger.
 *
 * WHY A RATCHET RATHER THAN "MIGRATE EVERYTHING NOW": 79 routes cannot be
 * rewritten safely in one change, and a big-bang rewrite of every auth path is
 * exactly how an escalation gets introduced rather than fixed.
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

function routeKeyFor(file: string): string {
  return relative(API_ROOT, file).split(sep).slice(0, -1).join('/')
}

/**
 * Lower this as routes are migrated. It must never go up.
 * 2026-07-26: 79 routes total, 1 enforced, 78 remaining.
 *
 * (An earlier substring-based count claimed 2 enforced. That was a comment
 * mentioning withAdmin(), not a wrapped handler — see codeOnly() below. The
 * measurement being wrong in the optimistic direction is exactly why the
 * detector now parses code rather than text.)
 */
const MAX_UNMIGRATED = 76

/**
 * Routes returning raw exception text to the client. Lower as routes migrate.
 * 2026-07-26: 40.
 */
const MAX_ERROR_LEAKS = 40

/**
 * Routes where a missing check is not a papercut. Unwrapping any of these
 * fails the build regardless of the count above.
 *
 * admin/features/[key] is here because it is the one that was actually
 * exploited: a viewer disabled a global kill-switch for the whole shopkeeper
 * app and got 200 OK.
 */
const MUST_ENFORCE = [
  'admin/features/[key]',
  // Clearing these silently is how real abuse and real incidents go unnoticed.
  'admin/fraud-alerts/[id]',
  'admin/anomalies/[id]',
]

const routeFiles = findRouteFiles(API_ROOT)

/**
 * Strips comments and string literals before analysis.
 *
 * The first version of this test matched the bare substring 'withAdmin(' and
 * immediately produced two false positives — both from explanatory COMMENTS
 * that named the function. A guard that cries wolf gets switched off, so it
 * has to read code rather than prose.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^\s*\/\/.*$/gm, '') // line comments
    .replace(/`(?:[^`\\]|\\.)*`/g, '``') // template literals
    .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
}

/** Migrated means a handler is actually EXPORTED through the wrapper. */
const MIGRATED_RE =
  /export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\s*=\s*withAdmin\s*\(/

function isMigrated(file: string): boolean {
  return MIGRATED_RE.test(codeOnly(readFileSync(file, 'utf8')))
}

describe('withAdmin adoption', () => {
  it('finds route files (guards against a broken walker)', () => {
    expect(routeFiles.length).toBeGreaterThan(50)
  })

  it('the number of unenforced routes never increases', () => {
    const unmigrated = routeFiles.filter((f) => !isMigrated(f)).map(routeKeyFor)
    expect(
      unmigrated.length,
      `Unenforced routes went UP to ${unmigrated.length} (cap ${MAX_UNMIGRATED}). ` +
        `A new route must use withAdmin(). If you migrated routes, lower ` +
        `MAX_UNMIGRATED in this file in the same commit.`,
    ).toBeLessThanOrEqual(MAX_UNMIGRATED)
  })

  it('the baseline is kept honest (no silent slack)', () => {
    // Stops the cap drifting far above reality, which would let regressions
    // slip in under an inflated budget.
    const unmigrated = routeFiles.filter((f) => !isMigrated(f)).length
    expect(
      MAX_UNMIGRATED - unmigrated,
      `MAX_UNMIGRATED (${MAX_UNMIGRATED}) is more than 5 above the real count ` +
        `(${unmigrated}). Lower it.`,
    ).toBeLessThanOrEqual(5)
  })

  it('every high-risk route enforces its policy', () => {
    const failures = MUST_ENFORCE.filter((key) => {
      const file = routeFiles.find((f) => routeKeyFor(f) === key)
      if (!file) return true // route vanished — treat as a failure, not a pass
      return !isMigrated(file)
    })
    expect(
      failures,
      `These routes MUST be wrapped in withAdmin():\n  ${failures.join('\n  ')}`,
    ).toEqual([])
  })

  it('no route leaks internal error text to clients (ratchet)', () => {
    // 40 routes return the raw exception to the caller, e.g.
    //     detail: String(error).slice(0, 300)
    // which surfaces Prisma messages, column names and constraint names to
    // anyone who can trigger a 500 — free schema reconnaissance. withAdmin()
    // logs the detail server-side and returns a typed shape with a requestId,
    // so each migrated route removes one. This caps the count so no new ones
    // appear while the migration proceeds.
    const leaking = routeFiles.filter((f) =>
      /detail:\s*(String\(error\)|error instanceof Error)/.test(
        codeOnly(readFileSync(f, 'utf8')),
      ),
    )
    expect(
      leaking.length,
      `Routes leaking internal error text went UP to ${leaking.length} ` +
        `(cap ${MAX_ERROR_LEAKS}). Return a typed error with a requestId and ` +
        `log the detail server-side instead.`,
    ).toBeLessThanOrEqual(MAX_ERROR_LEAKS)
  })

  it('no route reimplements authorisation by hand once wrapped', () => {
    // A wrapped route that also calls getServerSession() is a sign the old
    // check was left behind, which is how two sources of truth reappear.
    const offenders = routeFiles
      .filter(isMigrated)
      .filter((f) => /getServerSession\s*\(/.test(codeOnly(readFileSync(f, 'utf8'))))
      .map(routeKeyFor)
    expect(
      offenders,
      `Wrapped routes still calling getServerSession(): ${offenders.join(', ')}. ` +
        `Use the ctx passed by withAdmin().`,
    ).toEqual([])
  })
})
