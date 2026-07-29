import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { isReadReplicaConfigured } from '../src/lib/db'

/**
 * §D5 — read/write separation.
 *
 * WHY (audit 2026-07-28): the admin panel and the shopkeepers' app share one
 * database. An expensive admin report competes for the same connections and CPU
 * that a shopkeeper's "Save bill" needs. Yours can wait; theirs is a customer
 * standing at a counter. This project has already seen 2–5 second GETs under
 * pool contention — that is what exhausted Prisma's transaction budget mid-edit
 * and surfaced as "Failed to update transaction" on every attempt.
 *
 * `dbRead` routes read-only work to a replica when READ_DATABASE_URL is set.
 * NOTHING IN THE TYPE SYSTEM STOPS A WRITE ON IT — it is the same client type.
 * These tests are that guard.
 */

const API_ROOT = join(__dirname, '..', 'src', 'app', 'api', 'admin')

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** Strips comments — a comment quoting old code must not fail a guard. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const files = routeFiles(API_ROOT)

describe('dbRead is never used to write', () => {
  const MUTATIONS = [
    'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
  ]

  it('no route mutates through the read client', () => {
    // A write sent to a replica FAILS AT RUNTIME with a read-only transaction
    // error — but only once the replica exists. Today it would silently succeed
    // against the primary and look fine, then break the day the replica is
    // switched on. That delay is exactly why this is a test and not a comment.
    const offenders: string[] = []
    for (const f of files) {
      const src = codeOnly(readFileSync(f, 'utf8'))
      for (const verb of MUTATIONS) {
        const re = new RegExp(`\\bdbRead\\.[a-zA-Z]+\\.${verb}\\(`)
        if (re.test(src)) offenders.push(`${f.split('api\\admin\\')[1] ?? f} → dbRead.*.${verb}()`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no route runs $executeRaw or a transaction on the read client', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = codeOnly(readFileSync(f, 'utf8'))
      if (/dbRead\.\$executeRaw/.test(src)) offenders.push(`${f} → dbRead.$executeRaw`)
      if (/dbRead\.\$transaction/.test(src)) offenders.push(`${f} → dbRead.$transaction`)
    }
    expect(offenders).toEqual([])
  })
})

describe('the heavy reporting routes actually use it', () => {
  // A split nobody adopts is a split that does nothing. These are the routes
  // whose cost grows with the size of the business rather than the request.
  const SHOULD_USE_REPLICA = [
    'risk', 'ai-usage', 'growth', 'overview', 'revenue', 'subscriptions',
    'activity', 'anomalies', 'churn-predictions', 'audit-log',
  ]

  for (const route of SHOULD_USE_REPLICA) {
    it(`${route} reads from the replica`, () => {
      const src = readFileSync(join(API_ROOT, route, 'route.ts'), 'utf8')
      expect(src).toMatch(/\bdbRead\b/)
    })
  }
})

describe('routes that must stay on the primary', () => {
  it('login-probe does not use the replica', () => {
    // It exists to measure whether the PRIMARY is awake and reachable before a
    // login attempt. Pointing it at a replica would report the health of the
    // wrong database — and would say "fine" while logins were failing.
    const src = readFileSync(join(API_ROOT, 'login-probe', 'route.ts'), 'utf8')
    expect(src).not.toMatch(/\bdbRead\b/)
  })

  it('feature flags are read from the primary', () => {
    // These are kill switches. Reading them from anywhere other than the
    // authoritative copy is a bad default even where replication lag is zero:
    // "turn it off" must take effect from the source of truth.
    const src = readFileSync(join(API_ROOT, 'features', 'route.ts'), 'utf8')
    expect(src).not.toMatch(/\bdbRead\b/)
  })
})

describe('whether the replica is real is visible, not assumed', () => {
  it('reports honestly when READ_DATABASE_URL is unset', () => {
    // The failure mode is silence: dbRead appears throughout the code, everyone
    // believes admin load is isolated, and every query still lands on the
    // primary. Same reasoning as isRateLimitBackedByRedis().
    const original = process.env.READ_DATABASE_URL
    try {
      delete process.env.READ_DATABASE_URL
      expect(isReadReplicaConfigured()).toBe(false)
      process.env.READ_DATABASE_URL = 'postgres://replica/db'
      expect(isReadReplicaConfigured()).toBe(true)
    } finally {
      if (original === undefined) delete process.env.READ_DATABASE_URL
      else process.env.READ_DATABASE_URL = original
    }
  })

  it('falls back to the primary rather than failing when unconfigured', () => {
    // Shipping the split before the replica exists is the whole point: turning
    // it on later must be one environment variable, not a code change.
    const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'db.ts'), 'utf8')
    expect(src).toMatch(/const url = process\.env\.READ_DATABASE_URL/)
    expect(src).toMatch(/\.\.\.\(url \? \{ datasources/)
  })

  it('the read client is money-converted, exactly like the primary one', () => {
    // If dbRead were NOT wrapped, every figure on every migrated dashboard
    // would read 100x too high — the bug this audit opened with, reintroduced
    // by a performance change.
    const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'db.ts'), 'utf8')
    const fn = src.slice(src.indexOf('function createReadClient'), src.indexOf('export const dbRead'))
    expect(fn).toMatch(/withMoneyConversion/)
  })
})
