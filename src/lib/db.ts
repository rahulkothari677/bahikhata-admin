import { PrismaClient } from '@prisma/client'
import { withMoneyConversion } from './prisma-money-extension'

/**
 * Prisma client for the admin app.
 *
 * 🔴 MONEY (audit 2026-07-26): `db` is wrapped in the SAME money extension the
 * main app uses. Money is stored in the shared database as integer PAISE; the
 * extension converts paise -> rupees on read and rupees -> paise on write.
 *
 * Before this, the admin app used a bare PrismaClient against the same rows,
 * so a ₹499 subscription read as 49900 and rendered as "₹49,900". Every
 * revenue, MRR, ARR, GMV, P&L, subscription and GST figure in the panel was
 * 100x too large. Stored data was never wrong — only what the admin app read.
 *
 * TWO THINGS THE EXTENSION DOES NOT DO — you must handle these by hand:
 *   1. `where` clauses are NOT converted. `where: { totalAmount: { gte: 100000 } }`
 *      compares against 100000 PAISE (₹1,000), not ₹1,00,000. Wrap every money
 *      threshold in toPaise().
 *   2. $queryRaw results are NOT converted. Divide in SQL and alias the column
 *      (e.g. `total_amount / 100.0 AS total_rupees`) so the unit is visible.
 *
 * `dbReadonly` is deliberately NOT extended: it is used only for $queryRaw /
 * $queryRawUnsafe by the SQL console, which the extension cannot intercept
 * anyway. Keeping it a plain PrismaClient leaves that audited path unchanged.
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
 * ⚠️ DATABASE_URL MUST BE A READ-WRITE ROLE.
 *
 * This block previously claimed DATABASE_URL "should point to a READ-ONLY
 * database user" and that "the only write operations go through the main app's
 * API using ADMIN_API_SECRET — never direct DB writes". That was false, and
 * acting on it breaks the panel silently. The admin app writes directly to:
 *   - AdminAction      (every audit entry — and logAdminAction swallows errors,
 *                       so a read-only role produces a SILENT, EMPTY audit trail)
 *   - ImpersonationToken, FeatureFlag, DataExport, AdminUser
 *   - User             (plan changes, tokenVersion bumps)
 *
 * The correct control is a PURPOSE-SCOPED role, not a read-only one: grant the
 * admin role SELECT on shopkeeper tables and INSERT/UPDATE only on the tables
 * above. READONLY_DATABASE_URL (a genuinely SELECT-only role) is separate and
 * is required by the SQL console, which fails closed without it.
 */

function createExtendedClient() {
  return withMoneyConversion(
    new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    }),
  )
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createExtendedClient> | undefined
  prismaReadonly: PrismaClient | undefined
}

/** Money-converting client. All Prisma model calls return RUPEES. */
export const db = globalForPrisma.prisma ?? createExtendedClient()

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

// NOTE: deliberately a PLAIN PrismaClient (no money extension). It is used
// only for $queryRaw / $queryRawUnsafe by the SQL console, which the extension
// cannot intercept. In dev without READONLY_DATABASE_URL it gets its own plain
// client rather than falling back to the extended `db` — falling back to `db`
// would silently give the SQL console a different client type than production.
export const dbReadonly: PrismaClient =
  globalForPrisma.prismaReadonly ??
  (process.env.READONLY_DATABASE_URL
    ? new PrismaClient({
        datasources: { db: { url: process.env.READONLY_DATABASE_URL } },
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      })
    : new PrismaClient({
        // Dev-only fallback. Production returns 503 from the SQL console via
        // isReadonlyClientConfigured() before this is ever reached.
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      }))

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaReadonly = dbReadonly
