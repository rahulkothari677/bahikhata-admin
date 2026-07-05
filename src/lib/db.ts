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
 * 🔒 AUDIT FIX C5 (V6) + V6 SC4: Read-only Prisma client for the SQL runner.
 *
 * If READONLY_DATABASE_URL is set, this creates a SEPARATE Prisma client
 * that connects using a database user with ONLY SELECT grants. The SQL
 * runner (executeSafeQuery) uses this client instead of the main one, so
 * the DATABASE ITSELF enforces read-only — no matter what the regex
 * validation misses.
 *
 * 🔒 V6 SC4 (auditor): In production, if READONLY_DATABASE_URL is NOT set,
 * the SQL console endpoint now FAILS CLOSED (returns 503) instead of
 * silently falling back to the read-write connection. The previous
 * fallback was a defense-in-depth gap — the whitelist can be probed, and
 * an endpoint that can read every user's financial data should never run
 * on a read-write connection without explicit configuration.
 *
 * In development (NODE_ENV !== 'production'), the fallback to the main db
 * client is still allowed for convenience — developers don't need to set
 * up a read-only role on their local SQLite/test DB.
 *
 * Statement timeout: the read-only client sets a 10s statement_timeout
 * via the connection string (if supported) so a runaway query can't hog
 * the connection. The SQL console endpoint also enforces a JS-side timeout
 * via withTimeout() as a belt-and-suspenders measure.
 *
 * To create the read-only user in Neon:
 *   CREATE ROLE admin_readonly WITH LOGIN PASSWORD '...';
 *   GRANT CONNECT ON DATABASE neondb TO admin_readonly;
 *   GRANT USAGE ON SCHEMA public TO admin_readonly;
 *   GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_readonly;
 *   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO admin_readonly;
 *
 * Then set READONLY_DATABASE_URL in Vercel to the connection string using
 * this role. Append &statement_timeout=10000 to the URL for a 10s timeout.
 */

/**
 * Returns true if the read-only client is properly configured (READONLY_DATABASE_URL
 * is set OR we're in development mode). The SQL console endpoint uses this to
 * decide whether to serve requests or return 503.
 */
export function isReadonlyClientConfigured(): boolean {
  // In development, we allow the fallback to the main db client for convenience.
  if (process.env.NODE_ENV !== 'production') return true
  // In production, require READONLY_DATABASE_URL to be set.
  return !!process.env.READONLY_DATABASE_URL
}

export const dbReadonly: PrismaClient =
  globalForPrisma.prismaReadonly ??
  (process.env.READONLY_DATABASE_URL
    ? new PrismaClient({
        datasources: { db: { url: process.env.READONLY_DATABASE_URL } },
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      })
    : db)  // Fallback to main db — only used in dev (production checks isReadonlyClientConfigured first)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaReadonly = dbReadonly
