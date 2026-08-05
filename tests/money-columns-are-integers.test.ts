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
  const MIGRATION = path.join(
    ROOT,
    '../pro/prisma/migrations/20260712000001_paise_migration/migration.sql',
  )
  const hasSibling = fs.existsSync(MIGRATION)

  const run = hasSibling ? describe : describe.skip
  run('against the main app checkout', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8')
    const converted = [...sql.matchAll(/ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" TYPE (INTEGER|BIGINT)/gi)]
      .map((m) => ({ table: m[1], col: m[2] }))

    it('reads the migration', () => {
      expect(converted.length).toBeGreaterThan(50)
    })

    it('declares Int for every column the migration made an integer', () => {
      const drift = converted
        .filter((c) => models[c.table] && models[c.table][c.col] !== undefined)
        .filter((c) => !/^(Int|BigInt)\??$/.test(models[c.table][c.col]))
        .map((c) => `${c.table}.${c.col} is ${models[c.table][c.col]} here but INTEGER in the database`)
      expect(drift).toEqual([])
    })
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
