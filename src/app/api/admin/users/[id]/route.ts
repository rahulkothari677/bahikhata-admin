import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'
import { invalidateTokenVersionCache } from '@/lib/token-version-cache'
import { withNeonRetry } from '@/lib/resilience'

/**
 * GET /api/admin/users/[id]
 * Returns detailed info for a single user — full drill-down.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        renewsAt: true,
        cancelledAt: true,
        trialEndsAt: true,
        shops: {
          select: { id: true, name: true, gstin: true, state: true, isDefault: true }
        },
        _count: {
          select: {
            transactions: true,
            products: true,
            parties: true,
            aiUsageLogs: true,
            subscriptions: true,
            auditLogs: true,
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get recent transactions (last 10)
    const recentTransactions = await db.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        totalAmount: true,
        paymentMode: true,
        date: true,
        party: { select: { name: true } },
      },
    })

    // Get recent AI usage (last 10)
    const recentAiUsage = await db.aiUsageLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        feature: true,
        provider: true,
        model: true,
        totalTokens: true,
        costInr: true,
        success: true,
        createdAt: true,
      },
    })

    // Get AI usage stats for this user (all time)
    const aiStats = await db.aiUsageLog.aggregate({
      where: { userId: id },
      _sum: { costInr: true, totalTokens: true },
      _count: true,
    })

    // Get transaction stats
    const txStats = await db.transaction.aggregate({
      where: { userId: id, type: 'sale' },
      _sum: { totalAmount: true, grossProfit: true },
      _count: true,
    })

    // Get subscriptions
    const subscriptions = await db.subscription.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })

    return NextResponse.json({
      success: true,
      user,
      recentTransactions,
      recentAiUsage,
      aiStats: {
        totalCalls: aiStats._count,
        totalTokens: aiStats._sum.totalTokens || 0,
        totalCost: aiStats._sum.costInr || 0,
      },
      txStats: {
        totalSales: txStats._count,
        totalRevenue: txStats._sum.totalAmount || 0,
        totalProfit: txStats._sum.grossProfit || 0,
      },
      subscriptions,
    })
  } catch (error) {
    console.error('Admin user detail error:', error)
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/users/[id]
 * Updates a user's plan (founder/admin only).
 * This is the ONLY write operation — uses the admin app's DB write access.
 * For all other changes, we call the main app's API.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { plan, renewsAt } = body

    if (!['free', 'pro', 'elite'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { id }, select: { email: true, plan: true } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const oldPlan = user.plan
    // 🐛 INTEGRATION PHASE D.4: Bump tokenVersion so the user's existing JWT
    // is invalidated on the next request (within ~5 seconds via Redis cache,
    // or instantly if we successfully invalidate the cache below).
    // Without this bump, the user would keep their old plan's features for
    // up to 7 days (JWT maxAge) after the admin changes their plan.
    const updated = await withNeonRetry(() =>
      db.user.update({
        where: { id },
        data: {
          plan,
          renewsAt: renewsAt ? new Date(renewsAt) : plan === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          cancelledAt: null,
          // 🐛 D.4: increment tokenVersion to revoke existing JWTs
          tokenVersion: { increment: 1 },
        },
        select: { id: true, email: true, plan: true, renewsAt: true, tokenVersion: true },
      })
    )

    // 🐛 INTEGRATION PHASE D.4: Invalidate the main app's Redis cache for
    // this user's tokenVersion. The main app caches tokenVersion with a
    // 5-second TTL; deleting the cache entry makes the revocation instant
    // instead of waiting up to 5 seconds. Non-critical (5s TTL handles it
    // if Redis is down).
    await invalidateTokenVersionCache(id)

    // Log the admin action
    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'user_plan_change',
      description: `Changed ${user.email} plan from ${oldPlan} to ${plan} (tokenVersion bumped to ${updated.tokenVersion})`,
      targetType: 'user',
      targetId: id,
      metadata: { oldPlan, newPlan: plan, renewsAt: updated.renewsAt, tokenVersion: updated.tokenVersion },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({
      success: true,
      user: updated,
      message: `User plan changed from ${oldPlan} to ${plan}`,
    })
  } catch (error) {
    console.error('Admin user update error:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}
