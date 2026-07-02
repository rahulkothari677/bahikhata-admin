import { db } from '@/lib/db'

export interface Segment {
  id: string
  name: string
  description: string
  count: number
  color: string
  icon: string
  users: Array<{
    id: string
    email: string
    name: string
    plan: string
  }>
}

export async function getSegments(): Promise<{ segments: Segment[]; totalUsers: number }> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const users = await db.user.findMany({
    select: {
      id: true, email: true, name: true, plan: true,
      createdAt: true, updatedAt: true,
    },
  })

  // Fetch additional stats per user
  const usersWithStats = await Promise.all(
    users.map(async u => {
      const [txCountTotal, aiCount30d, totalSalesAgg] = await Promise.all([
        db.transaction.count({ where: { userId: u.id } }),
        db.aiUsageLog.count({ where: { userId: u.id, createdAt: { gte: thirtyDaysAgo } } }),
        db.transaction.aggregate({
          where: { userId: u.id, type: 'sale' },
          _sum: { totalAmount: true },
        }),
      ])
      return {
        ...u,
        name: u.name || u.email,
        txCountTotal,
        aiCount30d,
        totalSales: totalSalesAgg._sum.totalAmount || 0,
      }
    })
  )

  const segments: Segment[] = []

  const makeSegment = (
    id: string, name: string, description: string, color: string, icon: string,
    filtered: typeof usersWithStats,
  ): Segment => ({
    id, name, description, color, icon,
    count: filtered.length,
    users: filtered.map(u => ({ id: u.id, email: u.email, name: u.name, plan: u.plan })),
  })

  segments.push(makeSegment('power_users', 'Power Users', '50+ transactions, active in last 7 days', 'emerald', '⚡',
    usersWithStats.filter(u => u.txCountTotal >= 50 && u.updatedAt >= sevenDaysAgo)))

  segments.push(makeSegment('whales', 'Whales', '₹50K+ total sales volume', 'violet', '🐋',
    usersWithStats.filter(u => u.totalSales >= 50000)))

  segments.push(makeSegment('new_users', 'New Users', 'Signed up in last 7 days', 'blue', '🆕',
    usersWithStats.filter(u => u.createdAt >= sevenDaysAgo)))

  segments.push(makeSegment('at_risk', 'At Risk', 'Active 7-30 days ago, not since', 'amber', '⚠️',
    usersWithStats.filter(u => u.updatedAt >= thirtyDaysAgo && u.updatedAt < sevenDaysAgo && u.createdAt < sevenDaysAgo)))

  segments.push(makeSegment('churned', 'Churned', 'No activity in 30+ days', 'red', '💀',
    usersWithStats.filter(u => u.updatedAt < thirtyDaysAgo && u.createdAt < thirtyDaysAgo)))

  segments.push(makeSegment('ai_power', 'AI Power Users', '20+ AI calls in last 30 days', 'orange', '🤖',
    usersWithStats.filter(u => u.aiCount30d >= 20)))

  segments.push(makeSegment('free_active', 'Free Tier Active', 'Free plan, active in last 7 days', 'slate', '🆓',
    usersWithStats.filter(u => u.plan === 'free' && u.updatedAt >= sevenDaysAgo)))

  segments.push(makeSegment('paying', 'Paying Users', 'Pro or Elite plan', 'amber', '👑',
    usersWithStats.filter(u => u.plan === 'pro' || u.plan === 'elite')))

  segments.push(makeSegment('abandoned', 'Trial Abandoned', 'Signed up but never used the app', 'red', '🚫',
    usersWithStats.filter(u => u.txCountTotal === 0 && u.aiCount30d === 0 && u.createdAt < sevenDaysAgo)))

  segments.push(makeSegment('rising_stars', 'Rising Stars', '10+ transactions in first week', 'emerald', '🌟',
    usersWithStats.filter(u => {
      const ageDays = Math.floor((now.getTime() - u.createdAt.getTime()) / (24 * 60 * 60 * 1000))
      return ageDays <= 7 && u.txCountTotal >= 10
    })))

  return { segments, totalUsers: users.length }
}
