-- Grant the admin panel DELETE on the tables it deletes from.
--
-- WHY (audit 2026-08-05).
--
-- Deleting a webhook endpoint returned a flat 500 in production. Not a code
-- bug — Postgres refused the statement:
--
--     42501: permission denied for table "WebhookDelivery"
--
-- The role in DATABASE_URL has SELECT, INSERT and UPDATE but no DELETE. Every
-- delete route in the panel therefore fails, and fails uninformatively: Prisma
-- has no error code for a permission error, so it surfaces as
-- PrismaClientUnknownRequestError with no code at all.
--
-- 13 routes are affected, plus two unattended jobs that matter more than any
-- button: generateRevenueSchedule() deletes and recomputes a subscription's
-- revenue schedule, and the churn refresh deletes and rewrites each chunk.
-- Denied, both throw.
--
-- HOW TO RUN
--
--   1. Neon console -> your project -> SQL Editor.
--      Connect as the OWNER role (the one that created the tables), not the
--      role in DATABASE_URL — a role cannot grant itself privileges.
--   2. Run the whole file.
--   3. Reload GET /api/admin/database/grants and expect ok: true. That is the
--      verification — do not assume it worked.
--
-- The role name is not a guess. GET /api/admin/database/grants reported it
-- against the live database on 2026-08-05:
--
--     role: bahikhata_admin_app   database: neondb
--     all 15 tables: can_delete = false
--
-- If you ever rotate DATABASE_URL to a different role, that endpoint tells you
-- the new name — you do not have to open the secret to find out.
--
-- The list is deliberately explicit rather than "GRANT DELETE ON ALL TABLES".
-- All-tables would also hand the panel DELETE on User, Transaction, Payment and
-- every other shopkeeper table. A previous audit replaced admin bulk user
-- deletion with a soft delete on purpose; the missing grant is what makes that
-- decision enforceable at the database rather than merely intended in code.
--
-- Keep in step with src/lib/delete-grants.ts — a test fails if they diverge.

GRANT DELETE ON TABLE
  "AdminUser",
  "ApiKey",
  "BulkJob",
  "Campaign",
  "ChurnPrediction",
  "Competitor",
  "DataExportRequest",
  "Experiment",
  "FraudRule",
  "Incident",
  "NotificationTemplate",
  "NpsSurveyConfig",
  "RevenueSchedule",
  "WebhookDelivery",
  "WebhookEndpoint"
TO bahikhata_admin_app;

-- Confirm. Every row must show can_delete = true.
SELECT c.relname AS table_name,
       has_table_privilege('bahikhata_admin_app', c.oid, 'DELETE') AS can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'AdminUser','ApiKey','BulkJob','Campaign','ChurnPrediction','Competitor',
    'DataExportRequest','Experiment','FraudRule','Incident',
    'NotificationTemplate','NpsSurveyConfig','RevenueSchedule',
    'WebhookDelivery','WebhookEndpoint'
  )
ORDER BY c.relname;

-- And confirm the shopkeeper tables were NOT swept up. Expect false.
SELECT has_table_privilege('bahikhata_admin_app', '"User"', 'DELETE') AS user_delete_should_be_false;
