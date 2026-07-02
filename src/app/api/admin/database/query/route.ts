import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { validateQuery, executeSafeQuery } from '@/lib/database-admin'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/database/query
 *
 * Execute a read-only SQL query (SELECT only).
 * Max 1000 rows returned. 10s timeout. All queries logged.
 *
 * Body:
 *   - sql: string (required — must start with SELECT or WITH)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
