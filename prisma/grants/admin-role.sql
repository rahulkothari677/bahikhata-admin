-- ═══════════════════════════════════════════════════════════════════════════
-- DATABASE-LEVEL DURABILITY BACKSTOP for the admin app's role.
--
-- WHY (audit 2026-07-27): the admin panel must never destroy customer data.
-- src/lib/soft-delete.ts is the application-level control, but application
-- controls fail — a future contributor adds a `db.user.delete()`, a codemod
-- misfires, a dependency is compromised. This makes the DATABASE refuse.
--
-- The comment block in src/lib/db.ts previously claimed DATABASE_URL "should
-- point to a READ-ONLY database user". That was false and following it breaks
-- the panel: the admin app legitimately writes AdminAction, ImpersonationToken,
-- FeatureFlag, DataExport, AdminUser and User (plan changes, tokenVersion).
--
-- The correct control is a PURPOSE-SCOPED role: it may read shopkeeper data,
-- write its own operational tables, UPDATE specific user columns — and may
-- never DELETE or TRUNCATE anything.
--
-- Run as the Neon project owner. Idempotent; safe to re-run.
--
-- VERIFY AFTERWARDS (should raise "permission denied for table"):
--     SET ROLE bahikhata_admin_app;
--     DELETE FROM "User" WHERE id = 'nonexistent';
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. The admin application role ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bahikhata_admin_app') THEN
    CREATE ROLE bahikhata_admin_app LOGIN;
  END IF;
END
$$;

-- Set the password out of band; never commit it:
--   ALTER ROLE bahikhata_admin_app WITH PASSWORD '<from your secret manager>';

GRANT CONNECT ON DATABASE neondb TO bahikhata_admin_app;
GRANT USAGE ON SCHEMA public TO bahikhata_admin_app;

-- ─── 2. Baseline: read everything, write nothing ──────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bahikhata_admin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO bahikhata_admin_app;

-- ─── 3. Write access ONLY on the admin app's own operational tables ───────
GRANT INSERT, UPDATE ON
  "AdminAction",
  "AdminUser",
  "ImpersonationToken",
  "FeatureFlag",
  "DataExportRequest",
  "Incident",
  "IncidentUpdate",
  "FraudAlert",
  "FraudRule",
  "Anomaly",
  "BulkJob",
  "Campaign",
  "Experiment",
  "NotificationTemplate",
  "NotificationLog",
  "WebhookEndpoint",
  "WebhookDelivery",
  "ApiKey",
  "Competitor",
  "NpsSurveyConfig",
  "DailyStats",
  "RevenueSchedule",
  "ChurnPrediction",
  "Announcement"
TO bahikhata_admin_app;

-- User rows are UPDATED (plan changes, closure, tokenVersion) but never
-- inserted or deleted by the admin app. Signups happen in the main app.
GRANT UPDATE ON "User" TO bahikhata_admin_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bahikhata_admin_app;

-- ─── 4. THE BACKSTOP — no destruction, ever ───────────────────────────────
-- REVOKE is belt-and-braces: DELETE was never granted above. It is stated
-- explicitly so the intent survives someone later running a broad GRANT ALL.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM bahikhata_admin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE DELETE, TRUNCATE ON TABLES FROM bahikhata_admin_app;

REVOKE CREATE ON SCHEMA public FROM bahikhata_admin_app;

-- ─── 5. Append-only audit trail ───────────────────────────────────────────
-- The audit log must not be editable by the thing being audited. INSERT only:
-- no UPDATE, so an admin cannot rewrite the record of what they did.
REVOKE UPDATE, DELETE, TRUNCATE ON "AdminAction" FROM bahikhata_admin_app;
GRANT INSERT, SELECT ON "AdminAction" TO bahikhata_admin_app;

-- ─── 6. The SQL console's separate read-only role ─────────────────────────
-- READONLY_DATABASE_URL. The console already fails closed without it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bahikhata_readonly') THEN
    CREATE ROLE bahikhata_readonly LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE neondb TO bahikhata_readonly;
GRANT USAGE ON SCHEMA public TO bahikhata_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bahikhata_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO bahikhata_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
  FROM bahikhata_readonly;

-- Cap runaway analytics queries so the console cannot starve the shopkeepers'
-- app of connections.
ALTER ROLE bahikhata_readonly SET statement_timeout = '30s';
ALTER ROLE bahikhata_admin_app SET statement_timeout = '30s';
