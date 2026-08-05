/**
 * Which tables the admin app must be allowed to DELETE from.
 *
 * WHY THIS FILE EXISTS (audit 2026-08-05).
 *
 * Deleting a webhook endpoint returned a flat 500 in production. It was not a
 * code bug. Postgres was refusing the statement outright:
 *
 *     42501: permission denied for table "WebhookDelivery"
 *
 * The role in DATABASE_URL has SELECT, INSERT and UPDATE but not DELETE. That
 * is not an accident — db.ts recommends exactly this kind of purpose-scoped
 * role — but the grant was never widened to cover the tables the panel legally
 * needs to delete from, and nothing anywhere said so.
 *
 * The failure mode is the nasty kind: every one of these routes typechecks,
 * passes its unit tests (which mock the database), and fails only in
 * production, with a 500 whose cause Prisma cannot classify — a permission
 * error is not a Prisma error code, so it arrived as
 * PrismaClientUnknownRequestError with no `code` at all.
 *
 * Two of these are worse than a broken button, because they run unattended and
 * touch money:
 *
 *   RevenueSchedule   generateRevenueSchedule() deletes a subscription's
 *                     existing schedule and recomputes it. Denied, the whole
 *                     function throws, so revenue recognition silently stops
 *                     updating.
 *   ChurnPrediction   the refresh job deletes a chunk's old rows and rewrites
 *                     them. Denied, the job dies mid-chunk.
 *
 * So this list is the contract, `scripts/grant-admin-delete.sql` applies it,
 * GET /api/admin/database/grants proves it holds against the LIVE database, and
 * a test fails if a new delete call appears in a route without being added here.
 *
 * Adding a table here does NOT grant anything. Run the SQL.
 */

/**
 * Every table the admin app calls `.delete()` / `.deleteMany()` on.
 * No @@map anywhere in schema.prisma, so table names are the model names —
 * PascalCase, which Postgres requires to be double-quoted.
 */
export const TABLES_NEEDING_DELETE = [
  'AdminUser',
  'ApiKey',
  'BulkJob',
  'Campaign',
  'ChurnPrediction',
  'Competitor',
  'DataExportRequest',
  'Experiment',
  'FraudRule',
  'Incident',
  'NotificationTemplate',
  'NpsSurveyConfig',
  'RevenueSchedule',
  'WebhookDelivery',
  'WebhookEndpoint',
] as const

/**
 * Deliberately NOT on the list.
 *
 * `User` is the shopkeepers' own accounts. /api/admin/bulk once exposed
 * db.user.deleteMany() and a previous audit replaced it with a soft delete;
 * see src/lib/soft-delete.ts. The missing DELETE grant is, by accident, the
 * last line of defence behind that decision — so it stays missing, and this
 * constant records that it is a choice rather than an oversight.
 */
export const TABLES_DELIBERATELY_WITHOUT_DELETE = ['User'] as const
