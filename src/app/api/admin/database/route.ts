import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTableStats, getDatabaseOverview } from '@/lib/database-admin'

/**
 * GET /api/admin/database
 * Returns database overview + table statistics.
 *
 * Query: ?tab=overview|tables
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      error: 'Failed to fetch database stats',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
