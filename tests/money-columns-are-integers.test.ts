/**
 * Every money column this app writes must be declared Int, because the database
 * stores money as integer PAISE.
 *
 * WHY (audit 2026-08-05). Seven columns in this schema said `Float` while the
 * live Postgres columns were `integer`:
 *
 *   RevenueSchedule.amount
 *   DailyStats.mrr, newMrr, churnedMrr, arr, totalGmv, aiCostInr
 *
 * The main app converted them in prisma/migrations/20260712000001_paise_migration
 * (ALTER COLUMN ... TYPE INTEGER USING ROUND(amount * 100)). This app shares that
 * database but keeps its own schema copy, which was never updated. Prisma
 * therefore serialised a float8 into an int4 column and every WRITE failed:
 *
 *     22P03  incorrect binary data format in bind parameter 5
 *
 * Reads survived, so the panel looked fine. Writes did not, so revenue
 * recognition produced nothing at all and the daily-stats job could not save.
 *
 * It stayed hidden because a SECOND fault sat in front of it: the database role
 * had no DELETE privilege, and the recompute deletes before it inserts. Fixing
 * the grant let the INSERT run for the first time, and this surfaced instantly.
 * Two independent faults on one path, the outer one masking the inner one.
 *
 * This app has no prisma/migrations directory — the schema is pushed — so
 * nothing here can detect drift on its own. The main app's migrations are the
 * authority, and this test reads them directly rather than a hand-written list,
 * so a future paise migration cannot silently outrun it.
 *
 * If the sibling repo is not checked out (CI clones one repo), the comparison
 * skips and the local invariant below still runs.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { MONEY_COLUMNS } from '../src/lib/prisma-money-extension'
import { toPaise, fromPaise } from '../src/lib/money'

const ROOT = process.cwd()
const schema = fs.readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8').replace(/\r\n/g, '\n')

/** model -> field -> declared type, parsed from this app's schema. */
function parseModels(src: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const m of src.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
    const fields: Record<string, string> = {}
    for (const line of m[2].split('\n')) {
      const f = line.trim().match(/^(\w+)\s+(\w+)(\??)/)
      if (f && !f[1].startsWith('@')) fields[f[1]] = f[2] + f[3]
    }
    out[m[1]] = fields
  }
  return out
}

const models = parseModels(schema)

describe('the parser works, so the assertions below are not vacuous', () => {
  it('found models and fields', () => {
    expect(Object.keys(models).length).toBeGreaterThan(20)
    expect(models.RevenueSchedule?.amount).toBeDefined()
  })
})

describe('every field the money extension converts is an integer column', () => {
  /*
   * The extension multiplies rupees by 100 on write and divides on read. That
   * arithmetic only makes sense against an integer paise column, so this is the
   * invariant regardless of what any migration says.
   */
  const pairs = Object.entries(MONEY_COLUMNS).flatMap(([model, fields]) =>
    (fields as readonly string[]).map((f) => [model, f] as const),
  )

  it('covers a meaningful number of fields', () => {
    expect(pairs.length).toBeGreaterThan(20)
  })

  it.each(pairs)('%s.%s is Int', (model, field) => {
    const declared = models[model]?.[field]
    // A field the extension converts but the schema does not have is its own bug.
    expect(declared, `${model}.${field} is in MONEY_COLUMNS but not in schema.prisma`).toBeDefined()
    expect(declared, `${model}.${field} must be Int — money is stored as integer paise`).toMatch(
      /^(Int|BigInt)\??$/,
    )
  })
})

describe('this schema agrees with the migration that owns the database', () => {
  /*
   * WHY THIS SECTION WAS REWRITTEN (2026-08-07).
   *
   * It had two faults, and between them this comparison had never run anywhere
   * — not in CI, not on a developer's machine — since the day it was written.
   *
   * 1. `describe.skip` still EXECUTES its callback. Vitest runs the body to
   *    discover the tests it will then mark skipped. The readFileSync sat
   *    directly in that body, so it ran whether or not the guard said skip,
   *    threw ENOENT, and failed the whole file. The guard did not guard.
   *
   * 2. It looked for a sibling named `pro`. The repository is called
   *    `bahikhata-pro`, so even a developer with both checked out side by side
   *    got hasSibling === false.
   *
   * The result: admin CI was red from 2026-08-05, which also meant the Build
   * step never ran, and the one check standing between a paise migration and
   * silent write failures in production was inert. That is the exact class of
   * fault it exists to catch — seven columns drifted to Float once already and
   * killed revenue-recognition writes while reads looked fine.
   *
   * Reading is now lazy (inside `it`), so skipping actually skips, and the
   * sibling is resolved against several candidate paths. CI checks the main
   * repo out explicitly (see .github/workflows/ci.yml), so this runs there for
   * real rather than passing by being skipped — a gate that always says "pass"
   * is not a gate.
   */
  /*
   * MAIN_APP_PATH, when set, is the ONLY candidate — an explicit setting should
   * override, not merely join a queue. Without that, the guesses below always
   * win on a developer machine that happens to have the sibling checked out,
   * and the skip path becomes untestable: both "present" and "absent" runs find
   * the migration and pass, which looks like proof and is not.
   */
  const CANDIDATE_ROOTS = process.env.MAIN_APP_PATH
    ? [process.env.MAIN_APP_PATH]
    : [
        path.join(ROOT, '../bahikhata-pro'), // the repository's actual name
        path.join(ROOT, '../pro'),           // the old assumption, kept for anyone who used it
      ]

  const MIGRATION_SUFFIX = 'prisma/migrations/20260712000001_paise_migration/migration.sql'

  /** The first candidate that actually holds the migration, or null. */
  function findMigration(): string | null {
    for (const root of CANDIDATE_ROOTS) {
      const p = path.join(root, MIGRATION_SUFFIX)
      if (fs.existsSync(p)) return p
    }
    return null
  }

  const migrationPath = findMigration()

  /*
   * CI sets REQUIRE_MAIN_APP=1 after checking the main repo out. There, a
   * missing migration is a failure rather than a skip — otherwise the day
   * someone changes the checkout path, this quietly stops comparing anything
   * and nobody finds out until production writes start failing again.
   */
  it('the main app checkout is present when CI says it must be', () => {
    if (process.env.REQUIRE_MAIN_APP) {
      expect(
        migrationPath,
        `REQUIRE_MAIN_APP is set but no paise migration was found. Looked in:\n` +
          CANDIDATE_ROOTS.map((r) => `  ${path.join(r, MIGRATION_SUFFIX)}`).join('\n'),
      ).not.toBeNull()
    } else {
      expect(true).toBe(true) // locally, absence is fine — see below
    }
  })

  const run = migrationPath ? describe : describe.skip
  run('against the main app checkout', () => {
    // Lazy: this must NOT run during collection, or `.skip` cannot save us.
    const converted = () => {
      const sql = fs.readFileSync(migrationPath as string, 'utf8')
      return [...sql.matchAll(/ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" TYPE (INTEGER|BIGINT)/gi)]
        .map((m) => ({ table: m[1], col: m[2] }))
    }

    it('reads the migration', () => {
      expect(converted().length).toBeGreaterThan(50)
    })

    it('declares Int for every column the migration made an integer', () => {
      const drift = converted()
        .filter((c) => models[c.table] && models[c.table][c.col] !== undefined)
        .filter((c) => !/^(Int|BigInt)\??$/.test(models[c.table][c.col]))
        .map((c) => `${c.table}.${c.col} is ${models[c.table][c.col]} here but INTEGER in the database`)
      expect(drift).toEqual([])
    })
  })
})

describe('what the extension writes is always a whole number of paise', () => {
  /*
   * Declaring the column Int is only half of it. The value Prisma sends must
   * also BE an integer, or Postgres rejects it with the same 22P03.
   *
   * This is not theoretical for revenue schedules. A ₹2,999 yearly plan spread
   * over 12 months is ₹249.9166… per month. Multiplied by 100 that is 24991.66
   * paise — a fraction, into an integer column.
   *
   * The live database cannot demonstrate this either way: the only active
   * subscription is a comped Pro grant worth ₹0, and 0 × 100 = 0 whether the
   * conversion rounds or not. Verified against production on 2026-08-05 —
   * totalActiveRevenue: 0, planDistribution.pro.revenue: 0. So the guarantee
   * has to be pinned here instead.
   */
  const REALISTIC = [
    2999 / 12,   // yearly Pro spread monthly — 249.9166…
    4999 / 12,   // yearly Elite
    499,         // monthly Pro
    1.005,       // the float-representation trap toPaise() exists to fix
    0.1 + 0.2,   // 0.30000000000000004
    0,           // the comped grant that is actually in the database

    /*
     * These six are the ones that give this test teeth, and they were added
     * only after breaking it proved the others did not.
     *
     * Removing the Math.round from toPaise() still passed with the six values
     * above, because every one of them happens to multiply cleanly: 249.92 × 100
     * is exactly 24992 in binary floating point. A guard that survives the bug
     * it is meant to catch is not a guard.
     *
     * Below, x × 100 lands just off an integer — 0.07 × 100 is
     * 7.000000000000001, 0.29 × 100 is 28.999999999999996 — which is precisely
     * the fractional value Postgres would reject from an int4 column.
     */
    0.07, 0.14, 0.28, 0.29, 0.55, 0.57,
  ]

  it.each(REALISTIC)('toPaise(%p) is a whole number', (rupees) => {
    const paise = toPaise(rupees)
    expect(Number.isInteger(paise), `${rupees} → ${paise} is not an integer`).toBe(true)
  })

  it('does not lose more than half a paise on the way back', () => {
    // Half a paise is the most rounding to the nearest paise can cost. The
    // epsilon is for the comparison itself, not the conversion: 1.005 lands on
    // 0.005000000000000115 because that is how the subtraction reads in binary
    // floating point, which is the very effect toPaise() exists to absorb.
    for (const r of REALISTIC) {
      expect(Math.abs(fromPaise(toPaise(r)) - r)).toBeLessThanOrEqual(0.005 + 1e-9)
    }
  })

  it('the trap case rounds up, not down', () => {
    // 1.005 × 100 in floating point is 100.499…, which Math.round takes to 100.
    expect(toPaise(1.005)).toBe(101)
  })
})

describe('nothing can push this schema over the real database', () => {
  it('has no prisma db push script', () => {
    // The database is owned by the main app's migrations. A `db push` from here
    // would try to convert the paise columns BACK to double precision.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const scripts: Record<string, string> = pkg.scripts || {}
    const pushes = Object.entries(scripts).filter(([, v]) => /prisma\s+db\s+push/.test(v))
    expect(pushes).toEqual([])
  })
})
