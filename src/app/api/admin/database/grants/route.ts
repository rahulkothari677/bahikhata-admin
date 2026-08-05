import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { TABLES_NEEDING_DELETE, TABLES_DELIBERATELY_WITHOUT_DELETE } from '@/lib/delete-grants'

/**
 * GET /api/admin/database/grants
 *
 * Reports whether the LIVE database role can DELETE from each table the admin
 * app deletes from.
 *
 * WHY (audit 2026-08-05). Deleting a webhook endpoint returned a flat 500 in
 * production for weeks. The cause was `42501: permission denied for table
 * "WebhookDelivery"` — the DATABASE_URL role has SELECT/INSERT/UPDATE and not
 * DELETE. Nothing in the app could have told anyone that: the routes typecheck,
 * their unit tests mock the database, and Prisma reports a permission error as
 * PrismaClientUnknownRequestError with no code, so every affected route fails
 * identically and uninformatively.
 *
 * A missing grant is invisible until someone presses the button. This makes it
 * visible on demand, and it is how the fix gets verified rather than assumed:
 * run scripts/grant-admin-delete.sql, reload this, expect ok: true.
 *
 * Read-only. It runs on the MAIN client on purpose — dbReadonly is a different
 * role, so asking it would answer a question nobody asked. `has_table_privilege`
 * with the main client answers for the role that actually performs the deletes.
 *
 * `role` is included because the grant cannot be written without it and it is
 * not visible anywhere else: DATABASE_URL is a secret, and the panel has no
 * other way to show which database user it connects as.
 */
export const GET = withAdmin('admin/database/grants', async (_req: NextRequest) => {
  try {
    const tables = [...TABLES_NEEDING_DELETE]

    /*
     * has_table_privilege(regclass, 'DELETE') answers for current_user, which
     * is the role that runs the deletes. Parameterised, and the values come
     * from a constant in this repo rather than from the request.
     */
    const rows = await db.$queryRaw<{ table_name: string; can_delete: boolean }[]>`
      SELECT t.name AS table_name,
             has_table_privilege(quote_ident(t.name), 'DELETE') AS can_delete
      FROM unnest(${tables}::text[]) AS t(name)
    `

    const missing = rows.filter((r) => !r.can_delete).map((r) => r.table_name)
    const [{ current_user: role, current_database: database }] = await db.$queryRaw<
      { current_user: string; current_database: string }[]
    >`SELECT current_user, current_database()`

    return NextResponse.json({
      success: true,
      ok: missing.length === 0,
      role,
      database,
      missingDelete: missing,
      checked: rows,
      deliberatelyWithoutDelete: TABLES_DELIBERATELY_WITHOUT_DELETE,
      remedy:
        missing.length === 0
          ? null
          : `Run scripts/grant-admin-delete.sql as the database owner. Without it these admin deletes fail with a 500 that says nothing: ${missing.join(', ')}.`,
    })
  } catch (error) {
    const e = (error ?? {}) as { code?: unknown; name?: unknown; message?: unknown }
    console.error('[database/grants] failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to read table privileges',
        name: typeof e.name === 'string' ? e.name : undefined,
        code: e.code !== undefined ? String(e.code) : undefined,
        detail:
          typeof e.message === 'string' ? e.message.split('DETAIL:')[0].trim().slice(0, 300) : undefined,
      },
      { status: 500 },
    )
  }
})
