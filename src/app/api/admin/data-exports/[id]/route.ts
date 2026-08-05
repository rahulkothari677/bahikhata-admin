import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'

/**
 * DELETE /api/admin/data-exports/[id]
 * Delete an export request (and its file if exists).
 */
export const DELETE = withAdmin(
  'admin/data-exports/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.dataExportRequest.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Export not found' }, { status: 404 })

    await db.dataExportRequest.delete({ where: { id } })

    return NextResponse.json({ success: true, message: 'Export deleted' })
  } catch (error) {
    console.error('[admin/data-exports/[id]] failed:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
},
)
