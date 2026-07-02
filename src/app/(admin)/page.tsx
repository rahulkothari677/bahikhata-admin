import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { PageHeader, KPIGrid, KPICard, ContentCard } from '@/components/admin/ui'
import { ActivityFeedClient } from '@/components/admin/activity-feed'
import { Users, DollarSign, TrendingUp, Coins, Download } from 'lucide-react'
import { formatINR, formatNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'

async function getOverviewStats() {
  const now = new Date()
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  // Use aggregate queries — NO row fetching. Scales to millions.
  const [
    totalUsers,
    todayActiveUsers,
    totalGmvAgg,
    monthAiCostAgg,
    payingUsers,
    monthRevenueAgg,
    todaySignups,
    totalAiCalls,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { updatedAt: { gte: todayStart } } }),
    db.transaction.aggregate({ _sum: { totalAmount: true }, _count: true }),
    db.aiUsageLog.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costInr: true } }),
    db.user.count({ where: { plan: { in: ['pro', 'elite'] } } }),
    db.subscription.aggregate({ where: { status: 'active' }, _sum: { amount: true } }),
    db.user.count({ where: { createdAt: { gte: todayStart } } }),
    db.aiUsageLog.count(),
  ])

  return {
    totalUsers,
    todayActiveUsers,
    totalGmv: totalGmvAgg._sum.totalAmount || 0,
    totalTransactions: totalGmvAgg._count,
    monthAiCost: monthAiCostAgg._sum.costInr || 0,
    payingUsers,
    monthRevenue: monthRevenueAgg._sum.amount || 0,
    todaySignups,
    totalAiCalls,
  }
}

export default async function OverviewPage() {
  const stats = await getOverviewStats()
  const conversionRate = stats.totalUsers > 0 ? (stats.payingUsers / stats.totalUsers) * 100 : 0
  const profitMargin = stats.monthRevenue > 0
    ? Math.round(((stats.monthRevenue - stats.monthAiCost) / stats.monthRevenue) * 100)
    : null

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <PageHeader
        title="Dashboard"
        description="Real-time business overview"
      />

      {/* 4 KPI cards — ONLY the most critical numbers */}
      <KPIGrid>
        <KPICard
          label="Total Users"
          value={formatNumber(stats.totalUsers)}
          delta={`+${stats.todaySignups} today`}
          deltaType="positive"
          icon={Users}
          iconColor="text-blue-500"
        />
        <KPICard
          label="MRR"
          value={formatINR(stats.monthRevenue)}
          sublabel={`${stats.payingUsers} paying (${conversionRate.toFixed(1)}%)`}
          icon={DollarSign}
          iconColor="text-emerald-500"
        />
        <KPICard
          label="GMV"
          value={formatINR(stats.totalGmv)}
          sublabel={`${formatNumber(stats.totalTransactions)} transactions`}
          icon={TrendingUp}
          iconColor="text-amber-500"
        />
        <KPICard
          label="AI Cost (Month)"
          value={formatINR(stats.monthAiCost)}
          sublabel={profitMargin !== null ? `${profitMargin}% margin` : '—'}
          icon={Coins}
          iconColor="text-orange-500"
        />
      </KPIGrid>

      {/* Secondary stats — smaller, less critical */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Active Today</p>
          <p className="text-lg font-bold mt-0.5">{formatNumber(stats.todayActiveUsers)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total AI Calls</p>
          <p className="text-lg font-bold mt-0.5">{formatNumber(stats.totalAiCalls)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">New Today</p>
          <p className="text-lg font-bold mt-0.5">{stats.todaySignups}</p>
        </div>
      </div>

      {/* Activity Feed — the ONE main content area */}
      <ContentCard>
        <ActivityFeedClient />
      </ContentCard>
    </div>
  )
}
