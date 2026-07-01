import { db } from '@/lib/db'
import { formatINR, formatDate } from '@/lib/utils'
import { CreditCard, Crown } from 'lucide-react'

export const dynamic = 'force-dynamic'

async function getSubscriptions() {
  const [active, recent] = await Promise.all([
    db.subscription.findMany({
      where: { status: 'active' },
      include: { User: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.subscription.findMany({
      include: { User: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  const totalMrr = active.reduce((sum, s) => {
    // Monthly equivalent: monthly = amount, yearly = amount/12
    const monthly = s.endDate.getTime() - s.startDate.getTime() > 60 * 24 * 60 * 60 * 1000
      ? s.amount / 12
      : s.amount
    return sum + monthly
  }, 0)

  return { active, recent, totalMrr, activeCount: active.length }
}

export default async function SubscriptionsPage() {
  const { active, recent, totalMrr, activeCount } = await getSubscriptions()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-violet-600" />
          Subscriptions
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Active subscriptions and payment history</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Subscriptions</p>
          <p className="text-2xl font-bold mt-1">{activeCount}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Monthly Recurring Revenue</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600">{formatINR(totalMrr)}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg Revenue/User</p>
          <p className="text-2xl font-bold mt-1">{activeCount > 0 ? formatINR(totalMrr / activeCount) : '—'}</p>
        </div>
      </div>

      {/* Active subscriptions */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">Active Subscriptions</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No active subscriptions yet</p>
        ) : (
          <div className="space-y-2">
            {active.map(sub => (
              <div key={sub.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Crown className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{sub.User?.name || sub.User?.email}</p>
                    <p className="text-xs text-muted-foreground">{sub.User?.email}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    sub.plan === 'elite' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {sub.plan}
                  </span>
                  <p className="text-sm font-bold mt-0.5">{formatINR(sub.amount)}</p>
                  <p className="text-xs text-muted-foreground">Renews {formatDate(sub.endDate)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent payment history */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">Recent Payment History (last 20)</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No payments yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2">User</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2">Plan</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Amount</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2">Status</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-3 py-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map(sub => (
                  <tr key={sub.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">{sub.User?.email}</td>
                    <td className="px-3 py-2 capitalize">{sub.plan}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{formatINR(sub.amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        sub.status === 'active' ? 'bg-success/10 text-success' :
                        sub.status === 'cancelled' ? 'bg-destructive/10 text-destructive' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">{formatDate(sub.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
