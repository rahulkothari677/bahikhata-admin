import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { ROUTE_POLICY } from '../src/lib/route-policy'

/**
 * Every route's declared policy key must equal its own path on disk.
 *
 * WHY: withAdmin(routeKey, handler) takes the key as a HAND-TYPED STRING, and
 * looks the policy up by it:
 *
 *     const policy = ROUTE_POLICY[routeKey]
 *
 * Nothing ties that string to the file it sits in. A copy-pasted route that
 * keeps the key it was copied from compiles, passes review, and silently runs
 * under ANOTHER route's policy — inheriting its allowed roles and, worse, its
 * `stepUp` flag. Paste the wrong key into a founder-only export and it can end
 * up governed by a viewer-readable dashboard's rules.
 *
 * This is the same failure the with-admin header warns about ("authorisation
 * that lives in a separate file from the route will drift from it"). Moving the
 * policy next to the route fixed the *lookup*; the key itself is still a string
 * that can drift, and only this test stops it.
 *
 * A missing key already fails closed at runtime (500 POLICY_MISSING). A WRONG
 * key does not fail at all — which is exactly why it needs a test.
 *
 * Verified genuine: retyping admin/bulk's key as 'admin/impersonate' makes this
 * fail; restoring it makes it pass.
 */

const API_ROOT = path.resolve(__dirname, '../src/app/api')

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) routeFiles(p, out)
    else if (e.name === 'route.ts') out.push(p)
  }
  return out
}

/** "…/src/app/api/admin/bulk/route.ts" -> "admin/bulk" */
function pathKeyOf(file: string): string {
  return path
    .relative(API_ROOT, file)
    .split(path.sep)
    .join('/')
    .replace(/\/route\.ts$/, '')
}

/** The first string literal passed to withAdmin(, allowing a newline or comment. */
function declaredKeyOf(src: string): string | null {
  const m = src.match(/withAdmin\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]([^'"]+)['"]/)
  return m ? m[1] : null
}

const guarded = routeFiles(API_ROOT)
  .map((file) => ({ file, src: fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }))
  .filter(({ src }) => src.includes('withAdmin'))
  .map(({ file, src }) => ({
    pathKey: pathKeyOf(file),
    declaredKey: declaredKeyOf(src),
  }))

describe('route policy keys', () => {
  it('finds the guarded routes at all — a zero here would make every case below vacuous', () => {
    expect(guarded.length).toBeGreaterThan(70)
  })

  it('extracts a key from every guarded route', () => {
    const missing = guarded.filter((g) => g.declaredKey === null).map((g) => g.pathKey)
    // If this fails the extractor has drifted, and the comparison below is
    // silently skipping routes rather than checking them.
    expect(missing).toEqual([])
  })

  it.each(guarded.filter((g) => g.declaredKey !== null).map((g) => [g.pathKey, g.declaredKey]))(
    '%s declares its own key',
    (pathKey, declaredKey) => {
      expect(declaredKey).toBe(pathKey)
    },
  )

  it('has a registered policy for every guarded route', () => {
    // A missing entry fails closed with a 500 at runtime — safe, but it means
    // the route is dead for everyone. Catch it here instead of in production.
    const unregistered = guarded
      .map((g) => g.pathKey)
      .filter((k) => !(k in ROUTE_POLICY))
    expect(unregistered).toEqual([])
  })

  it('registers no policy for a route that does not exist', () => {
    // The reverse drift: a policy left behind after a route was renamed or
    // deleted. Harmless at runtime, but it makes the DPDP processing register
    // (buildProcessingRegister) describe endpoints that are not there.
    const realKeys = new Set(routeFiles(API_ROOT).map(pathKeyOf))
    const orphans = Object.keys(ROUTE_POLICY).filter((k) => !realKeys.has(k))
    expect(orphans).toEqual([])
  })
})
