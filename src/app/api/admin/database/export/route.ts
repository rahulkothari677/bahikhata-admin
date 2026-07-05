import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-auth'
import { validateQuery, executeSafeQuery, exportToCsv } from '@/lib/database-admin'
import { logAdminAction } from '@/lib/audit'
import { isReadonlyClientConfigured } from '@/lib/db'

/**
 * POST /api/admin/database/export
 *
 * Execute a SELECT query and return results as CSV download.
 * Same validation as /query endpoint.
 *
 * Body:
 *   - sql: string (required)
 *   - filename: string (optional — default: export.csv)
 *
 * 🔒 AUDIT FIX V6 SC4: Same fail-closed behavior as /query endpoint.
 * In production, returns 503 if READONLY_DATABASE_URL is not set.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.error

    // 🔒 V6 SC4: Fail closed in production if READONLY_DATABASE_URL is not set.
    if (!isReadonlyClientConfigured()) {
      return NextResponse.json({
        error: 'SQL export disabled — read-only database not configured',
        detail: 'READONLY_DATABASE_URL is not set. See /api/admin/database/query for setup instructions.',
      }, { status: 503 })
    }

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
      adminId: (auth.session.user as any).id,
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
