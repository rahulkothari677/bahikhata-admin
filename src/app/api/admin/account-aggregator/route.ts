import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'
import { getAAOverview, requestConsent, getUserFinancialData, SUPPORTED_BANKS, isSimulationMode } from '@/lib/account-aggregator'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/account-aggregator
 * Query: ?tab=overview|data&userId=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const userId = url.searchParams.get('userId')

    if (tab === 'overview') {
      const overview = await getAAOverview()
      return NextResponse.json({
        success: true,
        overview,
        supportedBanks: SUPPORTED_BANKS,
        simulationMode: isSimulationMode(),
      })
    }

    // Data tab — fetch financial data for specific user
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const data = await getUserFinancialData(userId)
    return NextResponse.json({ success: true, data, simulationMode: isSimulationMode() })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch AA data' }, { status: 500 })
  }
}

/**
 * POST /api/admin/account-aggregator
 * Request consent for a user (initiate AA flow).
 *
 * Body: { userId, fipIds?: string[], purpose?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { userId, fipIds, purpose } = body

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    // Verify user exists
    const user = await withTimeout(
      db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }),
      5000
    ).catch(() => null)
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const result = await requestConsent({
      userId,
      fiuId: process.env.AA_FIU_ID || 'bahikhata-pro-fiu',
      fipIds: fipIds || ['HDFC', 'ICICI', 'SBI'],
      consentDurationDays: 90,
      dataFetchFromDays: 90,
      dataFetchToDays: 0,
      purpose: purpose || 'Credit assessment for lending',
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'aa_consent_request',
      description: `Requested AA consent for user ${user.email} (${result.simulationMode ? 'simulation' : 'production'})`,
      targetType: 'account_aggregator',
      targetId: result.consentId,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('AA consent error:', error)
    return NextResponse.json({ error: 'Failed to request consent' }, { status: 500 })
  }
}
