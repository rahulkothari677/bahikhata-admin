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
  prismaRead: ReturnType<typeof createExtendedClient> | undefined
  prismaReadonly: PrismaClient | undefined
}

/** Money-converting client. All Prisma model calls return RUPEES. */
export const db = globalForPrisma.prisma ?? createExtendedClient()

// Cache the client in dev to prevent connection exhaustion on hot reload
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * 🔒 §D5 — READ REPLICA (audit 2026-07-28).
 *
 * THE PROBLEM: the admin panel and the shopkeepers' app share one database. An
 * expensive admin query competes for the same connections and CPU that a
 * shopkeeper's "Save bill" needs. Yours is a report and can wait; theirs is a
 * customer standing at a counter.
 *
 * That is not theoretical here. This project has already seen 2–5 second GETs
 * under pool contention, which is what exhausted Prisma's transaction budget
 * mid-edit and surfaced as "Failed to update transaction" on every attempt.
 *
 * `dbRead` is for dashboards, lists, exports and analytics — anything that only
 * reads. When READ_DATABASE_URL is set it points at a Neon read replica, so
 * that work stops competing with the shopkeepers entirely.
 *
 * ⚠️ IT FALLS BACK TO THE PRIMARY when READ_DATABASE_URL is unset, which is the
 * state today. That is deliberate: shipping the split now means switching it on
 * later is one environment variable and a redeploy, with no code change and no
 * risky big-bang rewrite. But it also means adding `dbRead` to a route buys
 * NOTHING until the variable exists — see isReadReplicaConfigured(), which is
 * surfaced rather than assumed, for the same reason the rate limiter reports
 * whether Redis actually backs it.
 *
 * STALENESS: none worth worrying about. Neon replicas in the same region share
 * the storage layer, so a committed write is immediately visible on the
 * replica. This is not the usual streaming-replication lag trade-off.
 *
 * NEVER use `dbRead` for a write. It is typed as the same client, so nothing
 * stops you at compile time — the guard is the test in tests/read-replica.test.ts
 * asserting no mutation verb appears alongside it.
 */
function createReadClient() {
  const url = process.env.READ_DATABASE_URL
  return withMoneyConversion(
    new PrismaClient({
      ...(url ? { datasources: { db: { url } } } : {}),
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    }),
  )
}

/**
 * Read-only workload client. Points at the replica when configured, otherwise
 * at the primary. Money-converted, exactly like `db`, so swapping a dashboard
 * query from `db` to `dbRead` cannot change the numbers it returns.
 */
export const dbRead = globalForPrisma.prismaRead ?? createReadClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaRead = dbRead

/**
 * Whether reads are ACTUALLY going somewhere separate.
 *
 * Exposed because the failure mode is silence: without it, `dbRead` appears
 * everywhere in the code, everyone believes admin load is isolated, and every
 * query is still landing on the primary. Same reasoning as
 * isRateLimitBackedByRedis().
 */
export function isReadReplicaConfigured(): boolean {
  return !!process.env.READ_DATABASE_URL
}

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
