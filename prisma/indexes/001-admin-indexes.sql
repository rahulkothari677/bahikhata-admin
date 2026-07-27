-- ═══════════════════════════════════════════════════════════════════════════
-- Indexes backing the admin panel's query patterns.
--
-- ⚠️ RUN BY HAND, NOT THROUGH PRISMA. See prisma/indexes/README.md.
-- Prisma wraps migrations in a transaction; CREATE INDEX CONCURRENTLY cannot
-- run inside one. That combination caused the V12 outage on this project.
--
--   psql "$DIRECT_URL" -f prisma/indexes/001-admin-indexes.sql
--
-- Use DIRECT_URL, not the pooled host. Run one at a time. All are
-- IF NOT EXISTS, so re-running is safe.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── User: keyset pagination ──────────────────────────────────────────────
-- Admin lists sort by (createdAt DESC, id DESC). Without the id tie-break in
-- the index the planner sorts, which defeats the point of keyset paging.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_createdAt_id_idx"
  ON "User" ("createdAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_updatedAt_id_idx"
  ON "User" ("updatedAt" DESC, "id" DESC);

-- ─── User: soft-delete filter ─────────────────────────────────────────────
-- Every admin list carries `deletedAt IS NULL`. A PARTIAL index is used
-- deliberately: it indexes only live accounts, so it stays small and does not
-- grow with the closed-account archive.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_active_createdAt_idx"
  ON "User" ("createdAt" DESC, "id" DESC)
  WHERE "deletedAt" IS NULL;

-- ─── User: activity-count filters ─────────────────────────────────────────
-- Backs "users with more than N transactions", which was previously applied in
-- JavaScript after fetching a single page.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_txnCount_idx"
  ON "User" ("txnCount" DESC)
  WHERE "deletedAt" IS NULL;

-- ─── User: rollup staleness scan ──────────────────────────────────────────
-- compute-daily-stats selects users whose counters are stale. Without this it
-- sequentially scans the whole user table every night.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_countsUpdatedAt_idx"
  ON "User" ("countsUpdatedAt" NULLS FIRST);

-- ─── Transaction: the big one ─────────────────────────────────────────────
-- Per-user history lookups. Composite so the sort is satisfied by the index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_userId_createdAt_idx"
  ON "Transaction" ("userId", "createdAt" DESC);

-- Risk dashboard: high-value transactions in a recent window. Partial on the
-- paise threshold (Rs.1,00,000 = 10,000,000 paise) so the index covers only
-- the rows that query actually wants — a small fraction of the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_highValue_recent_idx"
  ON "Transaction" ("createdAt" DESC)
  WHERE "totalAmount" >= 10000000;

-- ─── AdminAction: the audit trail ─────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminAction_createdAt_id_idx"
  ON "AdminAction" ("createdAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminAction_adminId_createdAt_idx"
  ON "AdminAction" ("adminId", "createdAt" DESC);

-- "show me every denied access attempt" — the query you run during an incident.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminAction_action_createdAt_idx"
  ON "AdminAction" ("action", "createdAt" DESC);

-- ─── Subscription / revenue ───────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Subscription_status_createdAt_idx"
  ON "Subscription" ("status", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RevenueSchedule_status_periodStart_idx"
  ON "RevenueSchedule" ("status", "periodStart");

-- ─── AiUsageLog: cost tracking + the status health check ──────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AiUsageLog_createdAt_idx"
  ON "AiUsageLog" ("createdAt" DESC);

-- The public status page counts recent failures. Partial: failures are rare,
-- so this index stays tiny while making that count instant.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AiUsageLog_failures_recent_idx"
  ON "AiUsageLog" ("createdAt" DESC)
  WHERE "success" = false;

-- ─── After creating: refresh planner statistics ───────────────────────────
-- A new index the planner has no statistics for may simply be ignored.
ANALYZE "User";
ANALYZE "Transaction";
ANALYZE "AdminAction";
ANALYZE "Subscription";
ANALYZE "AiUsageLog";
