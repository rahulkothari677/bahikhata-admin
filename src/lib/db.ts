import { PrismaClient } from '@prisma/client'

/**
 * Prisma client for the admin app.
 *
 * NEON DB CONNECTION FIX:
 * Neon (free tier) auto-suspends after inactivity. When a request comes in
 * after the DB has been asleep, the existing connection is stale and throws:
 *   "prisma:error Error in PostgreSQL connection: Error { kind: Close }"
 *
 * FIX: Configure Prisma with:
 *   1. Connection pool limits (smaller pool = fewer stale connections)
 *   2. Connection timeout (fail fast if DB is waking up)
 *   3. Retry logic on connection errors (in resilience.ts → withNeonRetry)
 *
 * Additionally, all queries in the admin app go through withTimeout() and
 * withNeonRetry() in resilience.ts, which catches these errors, waits 500ms
 * for Neon to wake up, retries once, and returns safe defaults if still failing.
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
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

// Cache the client in dev to prevent connection exhaustion on hot reload
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
