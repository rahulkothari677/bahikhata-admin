import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { validateQuery, executeSafeQuery, exportToCsv } from '@/lib/database-admin'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/database/export
 *
 * Execute a SELECT query and return results as CSV download.
 * Same validation as /query endpoint.
 *
 * Body:
 *   - sql: string (required)
 *   - filename: string (optional — default: export.csv)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { sql, filename } = body

    if (!sql) {
      return NextResponse.json({ error: 'SQL query is required' }, { status: 400 })
    }

    const validation = validateQuery(sql)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const result = await executeSafeQuery(sql)
    const csv = exportToCsv(result)

    // Log export
    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'database_export',
      description: `Exported ${result.rowCount} rows as CSV (${result.durationMs}ms)`,
      targetType: 'database',
      metadata: {
        sql: sql.slice(0, 500),
        rowCount: result.rowCount,
      },
    })

    // Return CSV as downloadable file
    const csvFilename = filename || `export_${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename}"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({
      success: false,
      error: 'Export failed',
      detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }, { status: 500 })
  }
}
