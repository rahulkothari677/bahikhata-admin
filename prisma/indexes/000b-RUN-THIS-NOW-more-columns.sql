-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ RUN THIS NOW — admin login is broken until you do.
--
-- WHAT WENT WRONG (my mistake, 2026-07-28 — the SECOND time)
-- I added four columns to the app's schema, tested them against a LOCAL
-- database, then merged and deployed the code — without applying the same
-- change to production. The live app asks Postgres for columns Postgres does
-- not have, and the login page reports exactly that:
--
--   The column `AdminUser.stepUpVerifiedAt` does not exist in the current database
--
-- The same thing happened with 000a. Saying "I'll check next time" plainly did
-- not work, so scripts/check-schema-drift.ts now exists to catch it mechanically.
--
-- IS THIS SAFE?
-- Yes. Every statement only ADDS a column or an index. Nothing is deleted,
-- nothing is modified, no existing data is touched. Every one is IF NOT EXISTS,
-- so running it twice is harmless.
--
-- HOW TO RUN
-- Paste the whole file into the Neon SQL Editor and press **Run**.
-- (Run — NOT Explain, NOT Analyze. Those prefix EXPLAIN and always fail here.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── AdminUser: step-up authentication ────────────────────────────────────
-- Records when the operator last re-entered their authenticator code.
-- Read on every login, which is why its absence breaks sign-in entirely.
ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "stepUpVerifiedAt" TIMESTAMP(3);

-- ─── AdminAction: the tamper-evident audit chain ──────────────────────────
-- Each entry hashes its own contents together with the previous entry's hash,
-- so editing or deleting any historical row breaks every hash after it.
--
-- BIGSERIAL is deliberate: it creates the sequence AND numbers the rows that
-- already exist, so the chain has a deterministic order over your existing
-- audit history rather than relying on createdAt, which can collide at
-- millisecond resolution under concurrent writes.
ALTER TABLE "AdminAction"
  ADD COLUMN IF NOT EXISTS "seq" BIGSERIAL;

ALTER TABLE "AdminAction"
  ADD COLUMN IF NOT EXISTS "prevHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "hash"     VARCHAR(64);

-- Entries written before the chain existed keep hash = NULL. The verifier
-- skips those rather than reporting a false break — they are not tampered,
-- they simply predate the mechanism.
CREATE INDEX IF NOT EXISTS "AdminAction_seq_idx" ON "AdminAction" ("seq");

-- ─── Check it worked ──────────────────────────────────────────────────────
-- Should list all four rows.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_name = 'AdminUser'   AND column_name = 'stepUpVerifiedAt')
   OR (table_name = 'AdminAction' AND column_name IN ('seq', 'prevHash', 'hash'))
ORDER BY table_name, column_name;
