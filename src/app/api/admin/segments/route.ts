import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSegments } from '@/lib/segments'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { segments, totalUsers } = await getSegments()
    return NextResponse.json({ success: true, segments, totalUsers })
  } catch (error) {
    console.error('Segments error:', error)
    return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 })
  }
}
