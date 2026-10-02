/**
 * When a plan upgrade fails LIVE, the screen must say why.
 *
 * 🐛 2026-10-02. Rahul's elite upgrade failed on the live panel with "Failed to
 * update user". The same change had passed every test and a full browser run
 * against a local copy — whose database login can do anything. Production's
 * login (bahikhata_admin_app) is purpose-scoped, and db.ts's own list of tables
 * it may write never included Subscription, which the grant rule now writes.
 *
 * Two things fixed here, both about SEEING the cause rather than guessing it:
 *  1. the route translates the database's refusal into a sentence naming the
 *     table, instead of a catch-all;
 *  2. the live grants check now reports the write privileges the plan grant
 *     needs, and a SQL script exists to grant them.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describeDbFailure } from '@/lib/db-failure'
import { WRITE_GRANTS_NEEDED } from '@/lib/delete-grants'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n')

/** The shape Prisma really throws for a Postgres permission refusal: no code of its own. */
function prismaUnknown(message: string) {
  const e = new Error(message)
  e.name = 'PrismaClientUnknownRequestError'
  return e
}

describe('describeDbFailure reads the reason out of real error shapes', () => {
  it('a permission refusal names the table', () => {
    const f = describeDbFailure(
      prismaUnknown('Invalid `tx.subscription.createMany()` invocation:\n\nError occurred during query execution:\nConnectorError(... PostgresError { code: "42501", message: "permission denied for table Subscription" ...'),
    )
    expect({ kind: f.kind, table: f.table }).toEqual({ kind: 'permission', table: 'Subscription' })
    expect(f.message).toContain('"Subscription"')
    expect(f.message).toContain('nothing was changed')
  })

  it('a bare 42501 with no table is still a permission refusal', () => {
    expect(describeDbFailure(prismaUnknown('db error: code 42501')).kind).toBe('permission')
  })

  it('a transaction timeout is "busy", not a permission problem', () => {
    const e = Object.assign(new Error('Transaction already closed: A query cannot be executed on an expired transaction.'), { code: 'P2028' })
    expect(describeDbFailure(e).kind).toBe('busy')
  })

  it('a constraint is reported as one, with its rule', () => {
    const f = describeDbFailure(prismaUnknown('null value in column "x" violates not-null constraint "Subscription_x_not_null"'))
    expect({ kind: f.kind, named: f.message.includes('Subscription_x_not_null') }).toEqual({ kind: 'constraint', named: true })
  })

  it('anything else is "unknown" — never mislabelled as permission', () => {
    // A wrong diagnosis would send someone to grant privileges that change
    // nothing. Refusing to guess beats guessing.
    for (const e of [new Error('socket hang up'), 'weird', null, undefined, { foo: 1 }]) {
      expect(describeDbFailure(e).kind).toBe('unknown')
    }
  })

  it('never echoes SQL or values back to the screen', () => {
    const f = describeDbFailure(prismaUnknown('permission denied for table Subscription  SELECT secret_column FROM "User" WHERE email=\'a@b.c\''))
    expect(f.message).not.toMatch(/SELECT|secret_column|a@b\.c/)
  })
})

describe('the upgrade route says why', () => {
  it('uses the translator instead of a catch-all', () => {
    const src = read('src/app/api/admin/users/[id]/route.ts')
    const patch = src.slice(src.indexOf('export const PATCH'))
    expect({ translates: patch.includes('describeDbFailure(error)'), flat: /error: 'Failed to update user'/.test(patch) })
      .toEqual({ translates: true, flat: false })
  })
})

describe('the live grants check covers what a plan grant writes', () => {
  it('every table applyPlanGrant writes is on the write-grants list', () => {
    // The class, not the instance: if the grant rule starts writing another
    // table, the live check must ask about it, or the next refusal is silent.
    const rule = read('src/lib/plan-grant.ts')
    const written = new Set<string>()
    for (const [, model] of rule.matchAll(/tx\.(\w+)\.(?:update|updateMany|create|createMany|upsert)\(/g)) {
      written.add(model.charAt(0).toUpperCase() + model.slice(1))
    }
    expect(written.size).toBeGreaterThan(0) // the scan itself must find something
    const unlisted = [...written].filter((t) => !(t in WRITE_GRANTS_NEEDED))
    expect(unlisted).toEqual([])
  })

  it('Subscription needs INSERT and UPDATE — create the new grant, expire the old', () => {
    expect([...WRITE_GRANTS_NEEDED.Subscription].sort()).toEqual(['INSERT', 'UPDATE'])
  })

  it('the grants route asks about them, and the fix script exists', () => {
    const route = read('src/app/api/admin/database/grants/route.ts')
    expect({ asks: route.includes('WRITE_GRANTS_NEEDED'), reports: route.includes('missingWrite') })
      .toEqual({ asks: true, reports: true })
    const sql = read('scripts/grant-admin-plan-writes.sql')
    expect(sql).toMatch(/^GRANT INSERT, UPDATE ON TABLE "Subscription" TO \w+;$/m)
    // Additive only. A grant script that deletes or widens beyond its purpose
    // is a different kind of change and must never ride in on this one.
    expect(sql).not.toMatch(/^\s*(GRANT[^;]*DELETE|REVOKE|DROP|DELETE FROM|TRUNCATE)/im)
  })
})
