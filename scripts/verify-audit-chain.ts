/**
 * Verifies the audit log has not been tampered with.
 *
 * Recomputes every entry's hash and checks it links to the one before it.
 * Any edited, inserted or deleted historical row breaks the chain, and this
 * reports the first break.
 *
 * Run:  npx tsx scripts/verify-audit-chain.ts
 * Exits non-zero on a break, so it can be wired to a scheduled check.
 */
import { verifyAuditChain } from '../src/lib/audit'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const result = await verifyAuditChain()

  if (result.ok) {
    console.log(`✅ Audit chain intact — ${result.checked} entries verified.`)
    return
  }

  console.error(`❌ AUDIT CHAIN BROKEN after checking ${result.checked} entries.`)
  console.error(`   Entry id : ${result.brokenAt!.id}`)
  console.error(`   Sequence : ${result.brokenAt!.seq}`)
  console.error(`   Reason   : ${result.brokenAt!.reason}`)
  console.error('')
  console.error('   This means the audit log was modified outside the application.')
  console.error('   Treat it as a security incident: the record of admin activity')
  console.error('   can no longer be trusted from this point onward.')
  process.exitCode = 1
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
