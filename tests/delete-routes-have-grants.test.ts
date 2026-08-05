/**
 * Every table the panel deletes from must be covered by a DELETE grant.
 *
 * WHY (audit 2026-08-05). Deleting a webhook endpoint returned a flat 500 in
 * production. Not a code bug — Postgres refused it outright:
 *
 *     42501: permission denied for table "WebhookDelivery"
 *
 * The DATABASE_URL role has SELECT, INSERT and UPDATE but no DELETE, so all 13
 * delete routes fail, and they fail identically and uninformatively: Prisma has
 * no error code for a permission error, so it arrives as
 * PrismaClientUnknownRequestError with no code at all. That is why the first
 * attempt at a fix went after a foreign-key cascade instead — the response gave
 * nothing to go on.
 *
 * Nothing in the normal development loop can catch this. The routes typecheck,
 * their unit tests mock the database, and the build passes. It shows up only
 * when a human presses the button in production.
 *
 * What this test CAN do is stop the list going stale. Add a new
 * db.something.delete() to a route and the grant list must grow with it,
 * otherwise the next person meets the same silent 500 with the same missing
 * clue. It reads the routes, not a snapshot, so it cannot drift.
 *
 * It cannot verify the live database. GET /api/admin/database/grants does that,
 * and the SQL file says to check it rather than assume.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { TABLES_NEEDING_DELETE, TABLES_DELIBERATELY_WITHOUT_DELETE } from '../src/lib/delete-grants'

const ROOT = process.cwd()
const SQL = fs.readFileSync(path.join(ROOT, 'scripts/grant-admin-delete.sql'), 'utf8')
/** The statements only. The header explains why ON ALL TABLES is wrong, and a
 *  check that reads the explanation as if it were the code is not a check. */
const SQL_CODE = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

/** Recursively collect .ts files under a directory. */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return e.isFile() && p.endsWith('.ts') ? [p] : []
  })
}

/** Prisma model name -> table name. No @@map in schema.prisma, so they match. */
const toTable = (model: string) => model.charAt(0).toUpperCase() + model.slice(1)

/** Every `db.<model>.delete(` / `.deleteMany(` in real code, ignoring comments. */
function deleteTargets(): { table: string; file: string }[] {
  const files = [...walk(path.join(ROOT, 'src/app/api')), ...walk(path.join(ROOT, 'src/lib'))]
  const found: { table: string; file: string }[] = []
  for (const file of files) {
    for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim()
      // Skip comments — soft-delete.ts and prisma-money-extension.ts both
      // discuss `db.user.deleteMany()` in prose explaining why it was removed.
      if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue
      for (const m of line.matchAll(/\b(?:db|tx)\.([a-zA-Z]+)\.delete(?:Many)?\(/g)) {
        found.push({ table: toTable(m[1]), file: path.relative(ROOT, file).replace(/\\/g, '/') })
      }
    }
  }
  return found
}

describe('the schema of this check is sound', () => {
  it('actually finds delete calls — otherwise every assertion below is vacuous', () => {
    // Without this the whole file passes by finding nothing.
    expect(deleteTargets().length).toBeGreaterThan(10)
  })

  it('found the webhook delete that started this', () => {
    const files = deleteTargets().filter((t) => t.table === 'WebhookDelivery')
    expect(files.length).toBeGreaterThan(0)
  })
})

describe('every delete target is covered', () => {
  it('appears in TABLES_NEEDING_DELETE', () => {
    const allowed = new Set<string>([...TABLES_NEEDING_DELETE, ...TABLES_DELIBERATELY_WITHOUT_DELETE])
    const uncovered = [...new Set(deleteTargets().filter((t) => !allowed.has(t.table)).map((t) => `${t.table} (${t.file})`))]
    expect(uncovered, 'add these to src/lib/delete-grants.ts AND to scripts/grant-admin-delete.sql').toEqual([])
  })

  it('appears in the GRANT statement', () => {
    // The list and the SQL that applies it are two files; they drift silently.
    const missing = TABLES_NEEDING_DELETE.filter((t) => !SQL.includes(`"${t}"`))
    expect(missing, 'listed in delete-grants.ts but never granted').toEqual([])
  })

  it('has no table granted that the code never deletes from', () => {
    const granted = [...SQL.matchAll(/^\s*"([A-Za-z]+)",?$/gm)].map((m) => m[1])
    const extra = granted.filter((t) => !(TABLES_NEEDING_DELETE as readonly string[]).includes(t))
    expect(extra, 'granted more than the panel needs').toEqual([])
  })
})

describe('shopkeeper data stays out of it', () => {
  it('does not grant DELETE on User', () => {
    // A previous audit replaced admin bulk user deletion with a soft delete.
    // The missing grant is what makes that enforceable rather than intended.
    expect(SQL).not.toMatch(/^\s*"User",?\s*$/m)
    expect(TABLES_NEEDING_DELETE as readonly string[]).not.toContain('User')
  })

  it('does not grant DELETE on the ledger tables', () => {
    for (const t of ['Transaction', 'Payment', 'Party', 'Shop', 'BankStatement']) {
      expect(SQL).not.toMatch(new RegExp(`^\\s*"${t}",?\\s*$`, 'm'))
    }
  })

  it('never uses GRANT ... ON ALL TABLES, which would sweep those up', () => {
    expect(SQL_CODE).not.toMatch(/ON\s+ALL\s+TABLES/i)
  })
})

describe('the fix is verifiable rather than assumed', () => {
  it('the SQL tells the operator to confirm afterwards', () => {
    expect(SQL).toMatch(/has_table_privilege/)
    expect(SQL).toMatch(/database\/grants/)
  })

  it('a route exists to check the live grants', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/app/api/admin/database/grants/route.ts'))).toBe(true)
  })

  it('that route is registered in ROUTE_POLICY, or it fails closed with a 500', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'src/lib/route-policy.ts'), 'utf8')
    expect(policy).toMatch(/'admin\/database\/grants'/)
  })
})
