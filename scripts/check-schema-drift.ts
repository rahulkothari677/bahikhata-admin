/**
 * Detects columns that exist in schema.prisma but NOT in a live database.
 *
 * WHY THIS EXISTS (2026-07-28):
 * Twice now I added columns to the Prisma schema, verified against a LOCAL
 * database, and deployed the code without applying the change to production.
 * The result both times was the same: the live app asking Postgres for columns
 * it does not have. The second time it broke admin login outright.
 *
 * "I will remember to check" demonstrably does not work. This checks.
 *
 * Run it against PRODUCTION before deploying a schema change:
 *
 *   DATABASE_URL="<production url>" npx tsx scripts/check-schema-drift.ts
 *
 * Exits non-zero if the database is missing anything the code expects, so it
 * can gate a deploy.
 *
 * NOTE: it compares the code's EXPECTATIONS against reality. Extra columns in
 * the database are not reported — those are harmless to a running app, whereas
 * a missing one is an outage.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/** Parses model → column names out of schema.prisma. */
function parseSchema(): Map<string, string[]> {
  const src = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  const models = new Map<string, string[]>()

  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(src)) !== null) {
    const [, name, body] = m
    const columns: string[] = []

    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue

      const field = line.match(/^(\w+)\s+(\w+)(\[\])?/)
      if (!field) continue
      const [, fieldName, fieldType, isList] = field

      // Relation fields are not columns. A list is always a relation, and a
      // field whose type is another model is the object side of one — the
      // actual column is the scalar foreign key beside it.
      if (isList) continue
      if (/^[A-Z]/.test(fieldType) && !isScalar(fieldType)) continue

      columns.push(fieldName)
    }
    models.set(name, columns)
  }
  return models
}

function isScalar(t: string): boolean {
  return ['String', 'Int', 'BigInt', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'Bytes'].includes(t)
}

async function main() {
  const expected = parseSchema()

  const rows = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `

  const actual = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set())
    actual.get(r.table_name)!.add(r.column_name)
  }

  const problems: string[] = []

  for (const [model, columns] of expected) {
    const live = actual.get(model)
    if (!live) {
      problems.push(`TABLE MISSING: "${model}" — the whole table does not exist`)
      continue
    }
    for (const col of columns) {
      if (!live.has(col)) {
        problems.push(`COLUMN MISSING: "${model}"."${col}"`)
      }
    }
  }

  if (problems.length === 0) {
    console.log(`✅ No drift. ${expected.size} models checked against the database.`)
    return
  }

  console.error(`❌ The database is missing ${problems.length} thing(s) the code expects:\n`)
  for (const p of problems) console.error('   ' + p)
  console.error('')
  console.error('   Deploying now would break every request that touches them.')
  console.error('   Add them with an ALTER TABLE in prisma/indexes/ and run it FIRST.')
  process.exitCode = 1
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
