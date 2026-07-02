import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { PageHeader, KPIGrid, KPICard, ContentCard } from '@/components/admin/ui'
import { ActivityFeedClient } from '@/components/admin/activity-feed'
import { Users, DollarSign, TrendingUp, Coins, AlertCircle } from 'lucide-react'
import { formatINR, formatNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'

async function getOverviewStats() {
  const now = new Date()
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  // Use aggregate queries — NO row fetching. Scales to millions.
  // Each query wrapped individually so one failure doesn't crash everything.
  const safeCount = async (fn: () => Promise<number>) => {
    try { return await fn() } catch { return 0 }
  }
  const safeAggregate = async (fn: () => Promise<any>, field: string) => {
    try { const r = await fn(); return r._sum?.[field] || r._count || 0 } catch { return 0 }
  }

  const [
    totalUsers,
    todayActiveUsers,
    totalGmv,
    totalTransactions,
    monthAiCost,
    payingUsers,
    monthRevenue,
    todaySignups,
    totalAiCalls,
  ] = await Promise.all([
    safeCount(() => db.user.count()),
    safeCount(() => db.user.count({ where: { updatedAt: { gte: todayStart } } })),
    safeAggregate(() => db.transaction.aggregate({ _sum: { totalAmount: true } }), 'totalAmount'),
    safeCount(() => db.transaction.count()),
    safeAggregate(() => db.aiUsageLog.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costInr: true } }), 'costInr'),
    safeCount(() => db.user.count({ where: { plan: { in: ['pro', 'elite'] } } })),
    safeAggregate(() => db.subscription.aggregate({ where: { status: 'active' }, _sum: { amount: true } }), 'amount'),
    safeCount(() => db.user.count({ where: { createdAt: { gte: todayStart } } })),
    safeCount(() => db.aiUsageLog.count()),
  ])

  return {
    totalUsers,
    todayActiveUsers,
    totalGmv,
    totalTransactions,
    monthAiCost,
    payingUsers,
    monthRevenue,
    todaySignups,
    totalAiCalls,
  }
}

export default async function OverviewPage() {
  let stats: any = null
  let dbError = false

  try {
    stats = await getOverviewStats()
  } catch (error) {
    console.error('Overview stats error:', error)
    dbError = true
  }

  if (dbError || !stats) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Dashboard" description="Real-time business overview" />
        <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-6 text-center">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Database temporarily unavailable</p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            The database might be waking up (Neon free tier auto-suspends).
            Please refresh in a few seconds.
          </p>
        </div>
      </div>
    )
  }

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

      {/* Secondary stats */}
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

      {/* Activity Feed */}
      <ContentCard>
        <ActivityFeedClient />
      </ContentCard>
    </div>
  )
}
