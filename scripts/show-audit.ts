/** Local verification helper: print the recent admin audit trail. */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const rows = await db.adminAction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { action: true, description: true, targetId: true, createdAt: true, adminId: true },
  })
  for (const r of rows) {
    console.log(`${r.createdAt.toISOString()}  ${r.action.padEnd(16)}  ${r.description}`)
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
