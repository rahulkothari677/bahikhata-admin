import { PrismaClient } from '@prisma/client'

/**
 * Prisma client for the admin app.
 *
 * SECURITY: The DATABASE_URL env var should point to a READ-ONLY database user.
 * This means even if the admin app is compromised, the attacker cannot:
 *   - DELETE records
 *   - UPDATE user data
 *   - DROP tables
 *   - INSERT malicious data
 *
 * The only write operations (admin actions like plan changes) go through
 * the main app's API using ADMIN_API_SECRET — never direct DB writes.
 *
 * See DEPLOYMENT.md for creating the read-only database user.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
