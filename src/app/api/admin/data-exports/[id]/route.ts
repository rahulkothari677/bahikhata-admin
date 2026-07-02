import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * DELETE /api/admin/data-exports/[id]
 * Delete an export request (and its file if exists).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.dataExportRequest.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Export not found' }, { status: 404 })

    await db.dataExportRequest.delete({ where: { id } })

    return NextResponse.json({ success: true, message: 'Export deleted' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
