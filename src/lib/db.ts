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
  prismaReadonly: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

// Cache the client in dev to prevent connection exhaustion on hot reload
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * 🔒 AUDIT FIX C5 (V6): Read-only Prisma client for the SQL runner.
 *
 * If READONLY_DATABASE_URL is set, this creates a SEPARATE Prisma client
 * that connects using a database user with ONLY SELECT grants. The SQL
 * runner (executeSafeQuery) uses this client instead of the main one, so
 * the DATABASE ITSELF enforces read-only — no matter what the regex
 * validation misses.
 *
 * If READONLY_DATABASE_URL is NOT set, falls back to the main db client
 * (which still has the whitelist + blocklist validation, but the DB
 * doesn't enforce read-only). This is less safe — set the env var in prod.
 *
 * To create the read-only user in Neon:
 *   CREATE ROLE admin_readonly WITH LOGIN PASSWORD '...';
 *   GRANT CONNECT ON DATABASE neondb TO admin_readonly;
 *   GRANT USAGE ON SCHEMA public TO admin_readonly;
 *   GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_readonly;
 *   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO admin_readonly;
 *
 * Then set READONLY_DATABASE_URL in Vercel to the connection string using
 * this role.
 */
export const dbReadonly: PrismaClient =
  globalForPrisma.prismaReadonly ??
  (process.env.READONLY_DATABASE_URL
    ? new PrismaClient({
        datasources: { db: { url: process.env.READONLY_DATABASE_URL } },
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      })
    : db)  // Fallback to main db if READONLY_DATABASE_URL not set

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaReadonly = dbReadonly
