/** Local verification: repoint the test fraud alert at the user who actually has a high-value transaction. */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const big = await db.transaction.findFirst({
    where: { totalAmount: { gte: 100000 } }, // rupees via the money extension
    orderBy: { totalAmount: 'desc' },
    select: { userId: true, totalAmount: true },
  })
  if (!big) throw new Error('No high-value transaction seeded')

  await db.fraudAlert.update({
    where: { id: 'alert_test' },
    data: { userId: big.userId, status: 'open' },
  })
  console.log(`alert_test now points at user with a Rs.${big.totalAmount} transaction`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
