/** Local verification helper: shows whether closure preserved the books. */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const first = await db.user.findFirst({ orderBy: { email: 'asc' } })
  if (process.argv.includes('--first-id')) {
    console.log(first?.id ?? '')
    return
  }

  const users = await db.user.findMany({
    orderBy: { email: 'asc' },
    select: {
      id: true, email: true, deletedAt: true, retentionUntil: true,
      deletionReason: true, tokenVersion: true,
      _count: { select: { transactions: true, products: true, parties: true } },
    },
  })

  for (const u of users) {
    console.log(
      `${u.email.padEnd(24)} deleted=${u.deletedAt ? 'YES' : 'no '} ` +
        `tv=${u.tokenVersion} ` +
        `txns=${u._count.transactions} products=${u._count.products} parties=${u._count.parties} ` +
        `retainUntil=${u.retentionUntil?.toISOString().slice(0, 10) ?? '-'}`,
    )
  }
  const totalTxns = await db.transaction.count()
  console.log(`TOTAL transactions in DB: ${totalTxns}`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
