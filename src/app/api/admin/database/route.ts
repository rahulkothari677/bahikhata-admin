import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { getTableStats, getDatabaseOverview } from '@/lib/database-admin'

/**
 * GET /api/admin/database
 * Returns database overview + table statistics.
 *
 * Query: ?tab=overview|tables
 */
export const GET = withAdmin(
  'admin/database',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'

    if (tab === 'tables') {
      const stats = await getTableStats()
      return NextResponse.json({ success: true, tables: stats })
    }

    // Overview
    const overview = await getDatabaseOverview()
    const tables = await getTableStats()

    return NextResponse.json({
      success: true,
      overview,
      tables: tables.slice(0, 10), // Top 10 tables by size
    })
  } catch (error) {
    console.error('Database admin error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch database stats',    }, { status: 500 })
  }
},
)
