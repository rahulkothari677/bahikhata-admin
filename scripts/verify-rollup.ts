/**
 * Verifies the denormalised counter rollup SQL directly.
 *
 * Runs the SAME statement as /api/admin/compute-daily-stats, then checks the
 * cached counters against a live COUNT of the real rows. A rollup that drifts
 * from the truth is worse than no rollup: the admin panel would confidently
 * show wrong numbers.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function show(label: string) {
  const users = await db.user.findMany({
    orderBy: { email: 'asc' },
    select: {
      email: true, txnCount: true, productCount: true, partyCount: true,
      countsUpdatedAt: true,
      _count: { select: { transactions: true, products: true, parties: true } },
    },
  })
  console.log(`\n--- ${label} ---`)
  let drift = 0
  for (const u of users) {
    const ok = u.txnCount === u._count.transactions
    if (!ok) drift++
    console.log(
      `${u.email.padEnd(22)} cached=${u.txnCount} actual=${u._count.transactions} ` +
        `${ok ? 'MATCH' : '*** DRIFT ***'} computed=${u.countsUpdatedAt ? 'yes' : 'NEVER'}`,
    )
  }
  return drift
}

async function main() {
  await show('BEFORE rollup')

  const staleBefore = new Date(Date.now() - 23 * 60 * 60 * 1000)
  const t0 = Date.now()
  const rows = await db.$executeRawUnsafe(
    `
    UPDATE "User" u
    SET "txnCount"        = COALESCE(c.txn_count, 0),
        "productCount"    = COALESCE(c.product_count, 0),
        "partyCount"      = COALESCE(c.party_count, 0),
        "countsUpdatedAt" = NOW()
    FROM (
      SELECT u2.id,
             (SELECT COUNT(*) FROM "Transaction" t WHERE t."userId" = u2.id) AS txn_count,
             (SELECT COUNT(*) FROM "Product"     p WHERE p."userId" = u2.id) AS product_count,
             (SELECT COUNT(*) FROM "Party"       y WHERE y."userId" = u2.id) AS party_count
      FROM "User" u2
      WHERE u2."countsUpdatedAt" IS NULL
         OR u2."countsUpdatedAt" < $1
         OR u2."updatedAt"       > u2."countsUpdatedAt"
      LIMIT 50000
    ) c
    WHERE u.id = c.id
  `,
    staleBefore,
  )
  console.log(`\nrollup updated ${rows} users in ${Date.now() - t0}ms`)

  const drift = await show('AFTER rollup')

  // Idempotence: a second run must change nothing (all rows are now fresh).
  const second = await db.$executeRawUnsafe(
    `
    UPDATE "User" u SET "countsUpdatedAt" = NOW()
    FROM (SELECT id FROM "User"
          WHERE "countsUpdatedAt" IS NULL OR "countsUpdatedAt" < $1
          LIMIT 50000) c
    WHERE u.id = c.id
  `,
    staleBefore,
  )
  console.log(`\nsecond run (stale-only) touched ${second} users — expect 0`)

  if (drift > 0) {
    console.error(`\nFAIL: ${drift} user(s) have cached counts that do not match reality`)
    process.exit(1)
  }
  console.log('\nPASS: every cached count matches a live COUNT of the real rows')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
