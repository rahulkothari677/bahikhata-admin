-- =====================================================================
-- 🔒 AUDIT FIX V6 SC4: Create a read-only Postgres role for the admin SQL console.
-- =====================================================================
--
-- WHY: The admin panel's SQL console (/api/admin/database/query) can read
-- every user's financial data. In V6, the endpoint now FAILS CLOSED (503)
-- if READONLY_DATABASE_URL is not set. This script creates the role you
-- need to set that env var.
--
-- HOW TO RUN:
--   1. Open Neon console → your project → SQL Editor
--   2. Paste this entire script
--   3. Replace 'YOUR_STRONG_PASSWORD_HERE' with a real strong password
--      (generate one with: openssl rand -base64 24)
--   4. Run it
--   5. Copy the connection string from the output
--   6. Set READONLY_DATABASE_URL in Vercel → admin panel project →
--      Settings → Environment Variables
--
-- After this is set, the admin SQL console will work. Without it, the
-- console returns 503 in production (defense-in-depth: never run a
-- financial-data-reading endpoint on a read-write connection).
--
-- =====================================================================

-- Step 1: Create the role with a connection limit (prevents connection exhaustion)
-- Replace YOUR_STRONG_PASSWORD_HERE with a real password!
CREATE ROLE admin_readonly WITH LOGIN PASSWORD 'YOUR_STRONG_PASSWORD_HERE' CONNECTION LIMIT 5;

-- Step 2: Allow connection to the database
-- (Replace 'neondb' with your actual database name if different)
GRANT CONNECT ON DATABASE neondb TO admin_readonly;

-- Step 3: Allow access to the public schema
GRANT USAGE ON SCHEMA public TO admin_readonly;

-- Step 4: Grant SELECT on ALL existing tables (read-only — no INSERT/UPDATE/DELETE)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_readonly;

-- Step 5: Grant SELECT on ALL existing sequences (some SELECT queries reference sequences)
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO admin_readonly;

-- Step 6: Grant SELECT on FUTURE tables (so new migrations automatically work)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO admin_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO admin_readonly;

-- Step 7: Set a statement timeout on the role (10 seconds — kills runaway queries)
-- This is a belt-and-suspenders measure alongside the JS-side withTimeout()
-- in the SQL console endpoint.
ALTER ROLE admin_readonly SET statement_timeout = '10s';

-- Step 8: Verify the role was created
SELECT rolname, rolcanlogin, rolconnlimit
FROM pg_roles
WHERE rolname = 'admin_readonly';

-- =====================================================================
-- CONNECTION STRING (set this as READONLY_DATABASE_URL in Vercel):
--
--   postgresql://admin_readonly:YOUR_STRONG_PASSWORD_HERE@YOUR_NEON_HOST/neondb?sslmode=require&connection_limit=5&pool_timeout=10
--
-- To find YOUR_NEON_HOST: Neon console → Connection Details → Direct connection.
-- (Use the DIRECT host, not the pooler — the admin panel uses a small
-- connection limit (5) so direct is fine and avoids PgBouncer complexity.)
--
-- =====================================================================
--
-- TO REMOVE (if you want to roll back):
--   DROP ROLE IF EXISTS admin_readonly;
--   (This will fail if the role still has grants — revoke them first:
--    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM admin_readonly;
--    REVOKE USAGE ON SCHEMA public FROM admin_readonly;
--    REVOKE CONNECT ON DATABASE neondb FROM admin_readonly;
--    DROP ROLE admin_readonly;)
--
-- =====================================================================
