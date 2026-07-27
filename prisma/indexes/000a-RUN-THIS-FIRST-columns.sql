-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ RUN THIS FILE FIRST — BEFORE 000-run-this-one-now.sql
--
-- WHAT THIS IS
-- The code deployed to Vercel expects some new columns that do not exist in
-- the production database yet. This adds them.
--
-- WHY IT IS NEEDED (my mistake, 2026-07-27)
-- I added these columns to the app's schema file and tested them against a
-- LOCAL database, then merged and deployed the code — without applying the
-- same change to production. So the live app is asking Postgres for columns
-- Postgres does not have. Admin LOGIN is affected, because the login code
-- reads AdminUser.tokenVersion.
--
-- The index file failed with `column "deletedAt" does not exist` for exactly
-- this reason. Run this, then run the index file, and it will succeed.
--
-- IS THIS SAFE?
-- Yes. Every statement only ADDS a column. Nothing is deleted, nothing is
-- changed, no existing data is touched. Every one is IF NOT EXISTS, so running
-- it twice is harmless.
--
-- HOW TO RUN
-- Paste the whole file into the Neon SQL Editor and press **Run**.
-- (Press Run — NOT "Explain" and NOT "Analyze". Those two buttons try to
-- describe the query instead of executing it, which is what caused the
-- "syntax error at or near INDEX" message.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── AdminUser: session revocation ────────────────────────────────────────
-- Lets us log an admin out everywhere by bumping this number. Without the
-- column present, admin login itself fails.
ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- New admins default to the least powerful role instead of "admin".
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'viewer';

-- ─── User: account closure without data loss ──────────────────────────────
-- Closing an account sets these instead of deleting the row, so the
-- shopkeeper's books survive (GST s.36 requires 72 months, IT Rule 6F 6 years).
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "deletedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedBy"       TEXT,
  ADD COLUMN IF NOT EXISTS "deletionReason"  TEXT,
  ADD COLUMN IF NOT EXISTS "retentionUntil"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "anonymisedAt"    TIMESTAMP(3);

-- ─── User: cached activity counts ─────────────────────────────────────────
-- So the admin users list does not have to count every transaction per row.
-- countsUpdatedAt stays NULL until the nightly job first runs — the panel
-- shows "—" rather than a misleading "0".
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "txnCount"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "productCount"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "partyCount"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "countsUpdatedAt" TIMESTAMP(3);

-- ─── Check it worked ──────────────────────────────────────────────────────
-- Should list all 10 new column names.
SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name = 'User' AND column_name IN
        ('deletedAt','deletedBy','deletionReason','retentionUntil',
         'anonymisedAt','txnCount','productCount','partyCount','countsUpdatedAt'))
   OR (table_name = 'AdminUser' AND column_name = 'tokenVersion')
ORDER BY table_name, column_name;
