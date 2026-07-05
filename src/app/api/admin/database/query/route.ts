import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { validateQuery, executeSafeQuery } from '@/lib/database-admin'
import { logAdminAction } from '@/lib/audit'
import { isReadonlyClientConfigured } from '@/lib/db'

/**
 * POST /api/admin/database/query
 *
 * Execute a read-only SQL query (SELECT only).
 * Max 1000 rows returned. 10s timeout. All queries logged.
 *
 * Body:
 *   - sql: string (required — must start with SELECT or WITH)
 *
 * 🔒 AUDIT FIX V6 SC4: In production, this endpoint FAILS CLOSED (returns
 * 503) if READONLY_DATABASE_URL is not set. The auditor flagged that the
 * previous fallback to the read-write connection was a defense-in-depth
 * gap — the whitelist can be probed, and an endpoint that can read every
 * user's financial data should never run on a read-write connection
 * without explicit configuration.
 *
 * In development, the fallback is still allowed for convenience.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 🔒 V6 SC4: Fail closed in production if READONLY_DATABASE_URL is not set.
    // This is the single most sensitive endpoint in the admin panel — it can
    // read every user's financial data. Belt and suspenders: whitelist + read-
    // only DB role + statement timeout. If the read-only role isn't configured,
    // refuse to run rather than falling back to RW.
    if (!isReadonlyClientConfigured()) {
      return NextResponse.json({
        error: 'SQL console disabled — read-only database not configured',
        detail: 'READONLY_DATABASE_URL is not set. For security, the SQL console refuses to run on the read-write connection in production. Create a read-only Postgres role and set READONLY_DATABASE_URL in Vercel env vars. See src/lib/db.ts for the SQL commands.',
        hint: 'In Neon: CREATE ROLE admin_readonly WITH LOGIN PASSWORD \'...\'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_readonly;',
      }, { status: 503 })
    }

    const body = await req.json()
    const { sql } = body

    if (!sql || typeof sql !== 'string') {
      return NextResponse.json({ error: 'SQL query is required' }, { status: 400 })
    }

    // Validate query (SELECT only, no dangerous keywords)
    const validation = validateQuery(sql)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Execute
    const result = await executeSafeQuery(sql)

    // Log to audit trail
    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'database_query',
      description: `Executed SELECT query (${result.rowCount} rows, ${result.durationMs}ms)`,
      targetType: 'database',
      metadata: {
        sql: sql.slice(0, 500), // first 500 chars for audit
        rowCount: result.rowCount,
        durationMs: result.durationMs,
        truncated: result.truncated,
      },
    })

    return NextResponse.json({
      success: true,
      result: {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
        durationMs: result.durationMs,
      },
    })
  } catch (error) {
    console.error('Query execution error:', error)
    return NextResponse.json({
      success: false,
      error: 'Query execution failed',
      detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }, { status: 500 })
  }
}
