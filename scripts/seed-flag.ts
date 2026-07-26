/** Local verification helper: seed a feature flag to exercise role enforcement. */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  await db.featureFlag.upsert({
    where: { key: 'ai_scanner' },
    create: { id: 'flag_ai_scanner', key: 'ai_scanner', label: 'AI Bill Scanner', enabled: true },
    update: { enabled: true },
  })
  const f = await db.featureFlag.findUnique({ where: { key: 'ai_scanner' } })
  console.log('flag:', f?.key, '| enabled =', f?.enabled)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
