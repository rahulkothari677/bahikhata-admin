/**
 * LOCAL VERIFICATION SEED — never run against production.
 *
 * Writes money as RAW INTEGER PAISE using a PLAIN (unextended) Prisma client,
 * exactly the way the main app's rows actually sit in the shared database.
 * That is the whole point: if the admin app is reading correctly, it must turn
 * these paise into the rupee figures asserted in the comments below.
 *
 * Run: npx tsx scripts/seed-local.ts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'

const db = new PrismaClient()

// Expected rupee values, for assertion after seeding.
const EXPECTED = {
  monthlySubRupees: 499, // stored as 49_900 paise
  yearlySubRupees: 4999, // stored as 499_900 paise
  mrrRupees: 499 + 4999, // both are status:active
  smallTxnRupees: 1500, // 150_000 paise  -> must NOT be "high value"
  bigTxnRupees: 150000, // 15_000_000 paise -> MUST be "high value" (>= ₹1L)
  aiCostRupees: 12.5, // 1_250 paise
}

async function main() {
  console.log('Wiping local tables...')
  // Ordered child -> parent to respect FKs. deleteMany avoids the prepared
  // statement collisions $executeRawUnsafe hits against the prisma dev proxy.
  await db.aiUsageLog.deleteMany({})
  await db.subscription.deleteMany({})
  await db.transactionItem.deleteMany({})
  await db.transaction.deleteMany({})
  await db.product.deleteMany({})
  await db.party.deleteMany({})
  await db.adminAction.deleteMany({})
  await db.adminUser.deleteMany({})
  await db.dailyStats.deleteMany({})
  await db.user.deleteMany({})

  // ── Admin accounts ────────────────────────────────────────────────────
  // TOTP secrets are generated here so the verifying process can compute
  // valid codes itself (a deployed panel cannot be tested this way).
  const founderSecret = authenticator.generateSecret()
  const viewerSecret = authenticator.generateSecret()
  const password = await bcrypt.hash('LocalAudit#2026', 12)

  await db.adminUser.create({
    data: {
      email: 'auditor@test.local',
      name: 'Local Auditor',
      password,
      role: 'founder',
      isActive: true,
      totpEnabled: true,
      totpSecret: founderSecret,
    },
  })

  // Exists to prove the privilege-escalation finding: a viewer must not be
  // able to mutate feature flags, dismiss fraud alerts, etc.
  await db.adminUser.create({
    data: {
      email: 'viewer@test.local',
      name: 'Local Viewer',
      password,
      role: 'viewer',
      isActive: true,
      totpEnabled: true,
      totpSecret: viewerSecret,
    },
  })

  // ── Shopkeepers ───────────────────────────────────────────────────────
  const users = []
  for (let i = 1; i <= 3; i++) {
    users.push(
      await db.user.create({
        data: {
          email: `shop${i}@test.local`,
          name: `Test Shop ${i}`,
          phone: `98765432${i.toString().padStart(2, '0')}`,
          password,
          plan: i === 1 ? 'pro' : 'free',
        },
      }),
    )
  }

  // ── Money, written as RAW PAISE ───────────────────────────────────────
  await db.subscription.create({
    data: {
      id: 'sub_monthly_test',
      userId: users[0].id,
      plan: 'pro',
      status: 'active',
      amount: 49900, // ₹499.00
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })
  await db.subscription.create({
    data: {
      id: 'sub_yearly_test',
      userId: users[1].id,
      plan: 'elite',
      status: 'active',
      amount: 499900, // ₹4,999.00
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  })

  await db.transaction.create({
    data: {
      userId: users[0].id,
      type: 'sale',
      date: new Date(),
      subtotal: 150000,
      totalAmount: 150000, // ₹1,500 — below the ₹1L high-value threshold
      paidAmount: 150000,
    },
  })
  await db.transaction.create({
    data: {
      userId: users[1].id,
      type: 'sale',
      date: new Date(),
      subtotal: 15000000,
      totalAmount: 15000000, // ₹1,50,000 — genuinely high value
      paidAmount: 15000000,
    },
  })

  await db.aiUsageLog.create({
    data: {
      userId: users[0].id,
      feature: 'scan-bill',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      costInr: 1250, // ₹12.50
      success: true,
    },
  })

  console.log('\n=== SEEDED ===')
  console.log('founder : auditor@test.local / LocalAudit#2026')
  console.log('  TOTP  :', founderSecret)
  console.log('viewer  : viewer@test.local / LocalAudit#2026')
  console.log('  TOTP  :', viewerSecret)
  console.log('\nExpected rupee values in the admin UI:')
  console.log(JSON.stringify(EXPECTED, null, 2))

  // Prove the DB really holds paise, not rupees. This client is UNEXTENDED,
  // so whatever it prints is the literal column value.
  const raw = await db.subscription.findMany({
    select: { id: true, amount: true },
    orderBy: { amount: 'asc' },
  })
  console.log('\nRAW paise in DB (unextended client):', JSON.stringify(raw))
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
