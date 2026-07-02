import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { StatCard } from '@/components/admin/stat-card'
import { ActivityFeedClient } from '@/components/admin/activity-feed'
import { Users, DollarSign, TrendingUp, Coins, Activity, Zap, UserCheck, ShoppingCart } from 'lucide-react'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

async function getStats() {
  const now = new Date()
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const [
    totalUsers,
    todayActiveUsers,
    weekActiveUsers,
    monthActiveUsers,
    todaySignups,
    totalTransactions,
    totalGmv,
    totalAiCalls,
    todayAiCalls,
    monthAiCost,
    payingUsers,
    monthRevenue,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { updatedAt: { gte: todayStart } } }),
    db.user.count({ where: { updatedAt: { gte: weekStart } } }),
    db.user.count({ where: { updatedAt: { gte: monthStart } } }),
    db.user.count({ where: { createdAt: { gte: todayStart } } }),
    db.transaction.count(),
    db.transaction.aggregate({ _sum: { totalAmount: true } }),
    db.aiUsageLog.count(),
    db.aiUsageLog.count({ where: { createdAt: { gte: todayStart } } }),
    db.aiUsageLog.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costInr: true } }),
    db.user.count({ where: { plan: { in: ['pro', 'elite'] } } }),
    db.subscription.aggregate({ where: { status: 'active' }, _sum: { amount: true } }),
  ])

  // Recent signups (last 5)
  const recentSignups = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, email: true, name: true, plan: true, createdAt: true },
  })

  // Recent AI calls (last 5)
  const recentAiCalls = await db.aiUsageLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, feature: true, provider: true, model: true, totalTokens: true, costInr: true, success: true, createdAt: true },
  })

  return {
    totalUsers,
    todayActiveUsers,
    weekActiveUsers,
    monthActiveUsers,
    todaySignups,
    totalTransactions,
    totalGmv: totalGmv._sum.totalAmount || 0,
    totalAiCalls,
    todayAiCalls,
    monthAiCost: monthAiCost._sum.costInr || 0,
    payingUsers,
    monthRevenue: monthRevenue._sum.amount || 0,
    recentSignups,
    recentAiCalls,
  }
}

export default async function OverviewPage() {
  const stats = await getStats()
  const conversionRate = stats.totalUsers > 0 ? (stats.payingUsers / stats.totalUsers) * 100 : 0

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time business metrics for BahiKhata Pro</p>
      </div>

      {/* Primary Stats — 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value={formatNumber(stats.totalUsers)}
          delta={`+${stats.todaySignups} today`}
          deltaType="positive"
          icon={Users}
          iconColor="text-blue-500"
        />
        <StatCard
          label="Paying Users"
          value={formatNumber(stats.payingUsers)}
          sublabel={`${conversionRate.toFixed(1)}% conversion rate`}
          icon={UserCheck}
          iconColor="text-emerald-500"
        />
        <StatCard
          label="Total GMV"
          value={formatINR(stats.totalGmv)}
          sublabel={`${formatNumber(stats.totalTransactions)} transactions`}
          icon={ShoppingCart}
          iconColor="text-amber-500"
        />
        <StatCard
          label="MRR"
          value={formatINR(stats.monthRevenue)}
          sublabel="Monthly recurring revenue"
          icon={DollarSign}
          iconColor="text-violet-500"
        />
      </div>

      {/* Activity Stats — 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Today (DAU)"
          value={formatNumber(stats.todayActiveUsers)}
          sublabel={`${((stats.todayActiveUsers / Math.max(stats.totalUsers, 1)) * 100).toFixed(1)}% sticky`}
          icon={Activity}
          iconColor="text-blue-500"
        />
        <StatCard
          label="Weekly Active"
          value={formatNumber(stats.weekActiveUsers)}
          icon={TrendingUp}
          iconColor="text-emerald-500"
        />
        <StatCard
          label="AI Calls Today"
          value={formatNumber(stats.todayAiCalls)}
          sublabel={`${formatNumber(stats.totalAiCalls)} all-time`}
          icon={Zap}
          iconColor="text-amber-500"
        />
        <StatCard
          label="AI Cost (Month)"
          value={formatINR(stats.monthAiCost)}
          sublabel="Real cost from providers"
          icon={Coins}
          iconColor="text-orange-500"
        />
      </div>

      {/* Recent Activity — 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Signups */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            Recent Signups
          </h2>
          {stats.recentSignups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No users yet</p>
          ) : (
            <div className="space-y-2">
              {stats.recentSignups.map(user => (
                <div key={user.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                      {user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{user.name || user.email}</p>
                      <p className="text-[11px] text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      user.plan === 'elite' ? 'bg-violet-100 text-violet-700' :
                      user.plan === 'pro' ? 'bg-amber-100 text-amber-700' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {user.plan}
                    </span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(user.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent AI Calls */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            Recent AI Calls
          </h2>
          {stats.recentAiCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No AI calls yet</p>
          ) : (
            <div className="space-y-2">
              {stats.recentAiCalls.map(call => (
                <div key={call.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${call.success ? 'bg-success' : 'bg-destructive'}`} />
                    <div>
                      <p className="text-sm font-medium capitalize">{call.feature.replace('-', ' ')}</p>
                      <p className="text-[11px] text-muted-foreground">{call.provider} · {call.model}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">{formatNumber(call.totalTokens)} tokens</p>
                    <p className="text-[11px] text-muted-foreground">{formatINR(call.costInr)} · {formatRelativeTime(call.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Profitability Snapshot */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-amber-600" />
          Profitability Snapshot
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Revenue (MRR)</p>
            <p className="text-xl font-bold text-emerald-600">{formatINR(stats.monthRevenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">AI Cost (Month)</p>
            <p className="text-xl font-bold text-orange-600">{formatINR(stats.monthAiCost)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gross Margin</p>
            <p className="text-xl font-bold">
              {stats.monthRevenue > 0
                ? `${(((stats.monthRevenue - stats.monthAiCost) / stats.monthRevenue) * 100).toFixed(0)}%`
                : '—'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Real-time Activity Feed */}
      <ActivityFeedClient />
    </div>
  )
}
