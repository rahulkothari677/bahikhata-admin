/**
 * Demonstrates that the audit chain detects tampering.
 *
 * Writes three entries, verifies the chain, then edits a historical entry
 * exactly as an admin with database access would — and verifies again.
 */
import { PrismaClient } from '@prisma/client'
import { logAdminAction, verifyAuditChain } from '../src/lib/audit'

const db = new PrismaClient()

async function main() {
  await db.adminAction.deleteMany({})
  const admin = await db.adminUser.findFirst()
  if (!admin) throw new Error('Seed an admin first: npx tsx scripts/seed-local.ts')

  for (const [action, description] of [
    ['feature_toggle', 'Toggled "AI Bill Scanner" from ON to OFF'],
    ['user_plan_change', 'Changed shop1 from free to pro'],
    ['feature_toggle', 'Toggled "AI Bill Scanner" from OFF to ON'],
  ] as const) {
    await logAdminAction({ adminId: admin.id, action, description })
  }

  const before = await verifyAuditChain()
  console.log(`1. After 3 legitimate writes : ${before.ok ? '✅ INTACT' : '❌ BROKEN'} (${before.checked} entries)`)

  // The attack: an admin edits the log to soften what they did.
  const target = await db.adminAction.findFirst({ orderBy: { seq: 'asc' } })
  await db.adminAction.update({
    where: { id: target!.id },
    data: { description: 'Routine maintenance' },
  })
  console.log(`2. Edited entry ${target!.seq} to say "Routine maintenance"`)

  const after = await verifyAuditChain()
  console.log(`3. After tampering            : ${after.ok ? '❌ NOT DETECTED' : '✅ DETECTED'}`)
  if (!after.ok) {
    console.log(`   seq   : ${after.brokenAt!.seq}`)
    console.log(`   reason: ${after.brokenAt!.reason}`)
  }

  // The other attack: delete an inconvenient entry entirely.
  await db.adminAction.deleteMany({ where: { id: target!.id } })
  const afterDelete = await verifyAuditChain()
  console.log(`4. After DELETING that entry  : ${afterDelete.ok ? '❌ NOT DETECTED' : '✅ DETECTED'}`)
  if (!afterDelete.ok) console.log(`   reason: ${afterDelete.brokenAt!.reason}`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
