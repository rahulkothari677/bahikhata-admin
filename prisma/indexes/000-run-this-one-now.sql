-- ═══════════════════════════════════════════════════════════════════════════
-- RUN THIS ONE NOW (pre-launch, while the tables are still small).
--
-- Same indexes as 001-admin-indexes.sql, but WITHOUT "CONCURRENTLY".
--
-- Plain English: an index is like the index at the back of a book. Without it,
-- the database reads every single row to find what you asked for. With it, it
-- jumps straight there.
--
-- Building an index locks the table while it works. On an empty or small table
-- that is a few milliseconds and nobody notices — so this file is safe to run
-- all at once, right now, by pasting it into the Neon SQL Editor.
--
-- LATER, once you have real users and millions of rows, that lock would take
-- your app DOWN for minutes. That is what 001-admin-indexes.sql is for: it uses
-- CONCURRENTLY, which builds the index without locking, but has to be run one
-- statement at a time from a terminal.
--
-- So: run THIS file now. Keep 001 for when you are live and adding new indexes.
-- Running both is harmless — every statement is IF NOT EXISTS, so anything
-- that already exists is skipped.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "User_createdAt_id_idx"
  ON "User" ("createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "User_updatedAt_id_idx"
  ON "User" ("updatedAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "User_active_createdAt_idx"
  ON "User" ("createdAt" DESC, "id" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "User_txnCount_idx"
  ON "User" ("txnCount" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "User_countsUpdatedAt_idx"
  ON "User" ("countsUpdatedAt" NULLS FIRST);

CREATE INDEX IF NOT EXISTS "Transaction_userId_createdAt_idx"
  ON "Transaction" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Transaction_highValue_recent_idx"
  ON "Transaction" ("createdAt" DESC)
  WHERE "totalAmount" >= 10000000;

CREATE INDEX IF NOT EXISTS "AdminAction_createdAt_id_idx"
  ON "AdminAction" ("createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "AdminAction_adminId_createdAt_idx"
  ON "AdminAction" ("adminId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AdminAction_action_createdAt_idx"
  ON "AdminAction" ("action", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Subscription_status_createdAt_idx"
  ON "Subscription" ("status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "RevenueSchedule_status_periodStart_idx"
  ON "RevenueSchedule" ("status", "periodStart");

CREATE INDEX IF NOT EXISTS "AiUsageLog_createdAt_idx"
  ON "AiUsageLog" ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AiUsageLog_failures_recent_idx"
  ON "AiUsageLog" ("createdAt" DESC)
  WHERE "success" = false;

-- Tells the database to update its own statistics, so it actually notices the
-- new indexes and starts using them.
ANALYZE "User";
ANALYZE "Transaction";
ANALYZE "AdminAction";
ANALYZE "Subscription";
ANALYZE "AiUsageLog";
