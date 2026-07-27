/** Local verification helper: seed a fraud alert and an anomaly to triage. */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const rule = await db.fraudRule.upsert({
    where: { id: 'rule_test' },
    create: {
      id: 'rule_test',
      name: 'High transaction volume',
      metric: 'transaction_count',
      operator: 'gt',
      threshold: 100,
      enabled: true,
    },
    update: {},
  })

  const user = await db.user.findFirst()

  await db.fraudAlert.upsert({
    where: { id: 'alert_test' },
    create: {
      id: 'alert_test',
      ruleId: rule.id,
      userId: user!.id,
      userName: 'Test Shop 1',
      metricValue: 250,
      threshold: 100,
      status: 'open',
    },
    update: { status: 'open', acknowledgedAt: null, resolvedAt: null },
  })

  await db.anomaly.upsert({
    where: { id: 'anomaly_test' },
    create: {
      id: 'anomaly_test',
      metric: 'revenue',
      metricLabel: 'Daily Revenue',
      direction: 'drop',
      currentValue: 100,
      baselineValue: 5000,
      baselineStdDev: 350,
      zScore: -4.2,
      severity: 'critical',
      status: 'open',
      detectedAt: new Date(),
      windowStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
      windowEnd: new Date(),
    },
    update: { status: 'open', acknowledgedAt: null, resolvedAt: null },
  })

  console.log('seeded: fraudAlert=alert_test (open), anomaly=anomaly_test (open)')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
