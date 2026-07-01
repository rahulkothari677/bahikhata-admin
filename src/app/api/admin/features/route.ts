import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/features
 * Returns all feature flags.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const flags = await db.featureFlag.findMany({
      orderBy: { key: 'asc' },
    })

    return NextResponse.json({ success: true, flags })
  } catch (error) {
    console.error('Fetch features error:', error)
    return NextResponse.json({ error: 'Failed to fetch features' }, { status: 500 })
  }
}
