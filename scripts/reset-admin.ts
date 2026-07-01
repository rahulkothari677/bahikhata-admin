/**
 * Reset admin accounts — clears the AdminUser table so you can run /setup again.
 *
 * Usage:
 *   1. Set DATABASE_URL env var to your production database
 *   2. Run: npx tsx scripts/reset-admin.ts
 *
 * This is useful when:
 *   - You forgot your admin password
 *   - Setup says "account already exists" but you can't log in
 *   - You want to start fresh
 */

import { PrismaClient } from '@prisma/client'

async function main() {
  const prisma = new PrismaClient()

  try {
    console.log('🔍 Checking for existing admin accounts...')
    const count = await prisma.adminUser.count()

    if (count === 0) {
      console.log('✅ No admin accounts found. You can visit /setup to create one.')
      return
    }

    console.log(`📋 Found ${count} admin account(s):`)
    const admins = await prisma.adminUser.findMany({
      select: { id: true, email: true, name: true, role: true, totpEnabled: true, createdAt: true },
    })
    admins.forEach(a => {
      console.log(`   - ${a.email} (${a.name}) | role: ${a.role} | 2FA: ${a.totpEnabled ? 'ON' : 'OFF'} | created: ${a.createdAt.toISOString()}`)
    })

    console.log('')
    console.log('🗑️  Deleting all admin accounts...')
    await prisma.adminUser.deleteMany({})
    console.log('✅ All admin accounts deleted!')

    console.log('')
    console.log('👉 Next steps:')
    console.log('   1. Visit https://your-admin-url.vercel.app/setup')
    console.log('   2. Create a new admin account with a password you\'ll remember')
    console.log('   3. Log in at /login with your new credentials')
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
