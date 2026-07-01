'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, Crown, Coins, ShoppingCart, Zap, Loader2, Save, UserCog } from 'lucide-react'
import { StatCard } from '@/components/admin/stat-card'
import { formatINR, formatNumber, formatRelativeTime } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'

export default function UserDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const userId = params.id as string

  const [newPlan, setNewPlan] = useState('')
  const [saving, setSaving] = useState(false)
  const [showImpersonate, setShowImpersonate] = useState(false)
  const [impersonateReason, setImpersonateReason] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-user', userId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/users/${userId}`)
      return r.json()
    },
    enabled: !!userId,
  })

  // Initialize plan selector when data loads
  if (data?.user?.plan && !newPlan) {
    setNewPlan(data.user.plan)
  }

  const planMutation = useMutation({
    mutationFn: async (plan: string) => {
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      if (!r.ok) throw new Error('Failed to update plan')
      return r.json()
    },
    onSuccess: (data) => {
      sonnerToast.success(`Plan changed to ${data.user.plan}`)
      queryClient.invalidateQueries({ queryKey: ['admin-user', userId] })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setSaving(false)
    },
    onError: () => {
      sonnerToast.error('Failed to update plan')
      setSaving(false)
    },
  })

  const impersonateMutation = useMutation({
    mutationFn: async (reason: string) => {
      const r = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Failed to create impersonation link')
      return data
    },
    onSuccess: (data) => {
      sonnerToast.success('Impersonation link generated! Opening in new tab...')
      window.open(data.url, '_blank')
      setShowImpersonate(false)
      setImpersonateReason('')
    },
    onError: (err: Error) => {
      sonnerToast.error(err.message)
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.user) {
    return <div className="p-6 text-center text-muted-foreground">User not found</div>
  }

  const user = data.user

  return (
    <div className="p-6 space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/users')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to users
      </button>

      {/* User header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-2xl font-bold text-white">
          {user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{user.name || user.email}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              user.plan === 'elite' ? 'bg-violet-100 text-violet-700' :
              user.plan === 'pro' ? 'bg-amber-100 text-amber-700' :
              'bg-muted text-muted-foreground'
            }`}>
              {user.plan === 'elite' && <Crown className="w-3 h-3 inline mr-1" />}
              {user.plan}
            </span>
            <span className="text-xs text-muted-foreground">Joined {formatRelativeTime(user.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Transactions" value={formatNumber(user._count.transactions)} icon={ShoppingCart} iconColor="text-blue-500" />
        <StatCard label="Products" value={formatNumber(user._count.products)} icon={ShoppingCart} iconColor="text-emerald-500" />
        <StatCard label="AI Calls" value={formatNumber(user._count.aiUsageLogs)} icon={Zap} iconColor="text-amber-500" />
        <StatCard label="AI Cost" value={formatINR(data.aiStats.totalCost)} icon={Coins} iconColor="text-orange-500" />
      </div>

      {/* Plan management + Impersonate */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3">Plan Management</h2>
          <div className="flex items-center gap-3">
            <select
              value={newPlan}
              onChange={(e) => setNewPlan(e.target.value)}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="free">Free</option>
              <option value="pro">Pro (₹299/mo)</option>
              <option value="elite">Elite (₹599/mo)</option>
            </select>
            <button
              onClick={() => {
                setSaving(true)
                planMutation.mutate(newPlan)
              }}
              disabled={saving || newPlan === user.plan}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Changing plan updates immediately. All actions are logged in the audit trail.
          </p>
        </div>

        {/* Impersonate */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <UserCog className="w-4 h-4 text-violet-500" />
            Impersonate User
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Log in as this user to debug their issues. Requires a reason (logged permanently).
          </p>
          {showImpersonate ? (
            <div className="space-y-2">
              <input
                value={impersonateReason}
                onChange={(e) => setImpersonateReason(e.target.value)}
                placeholder="Why are you impersonating? (min 10 chars)"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => impersonateMutation.mutate(impersonateReason)}
                  disabled={impersonateReason.length < 10 || impersonateMutation.isPending}
                  className="px-4 py-2 bg-violet-500 text-white rounded-lg text-sm font-medium hover:bg-violet-600 disabled:opacity-50 flex items-center gap-2"
                >
                  {impersonateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Generate Link
                </button>
                <button
                  onClick={() => { setShowImpersonate(false); setImpersonateReason('') }}
                  className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowImpersonate(true)}
              className="px-4 py-2 bg-violet-500 text-white rounded-lg text-sm font-medium hover:bg-violet-600 flex items-center gap-2"
            >
              <UserCog className="w-4 h-4" />
              Impersonate This User
            </button>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">Recent Transactions (last 10)</h2>
        {data.recentTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No transactions yet</p>
        ) : (
          <div className="space-y-2">
            {data.recentTransactions.map((tx: any) => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    tx.type === 'sale' ? 'bg-emerald-500' :
                    tx.type === 'purchase' ? 'bg-amber-500' :
                    'bg-blue-500'
                  }`} />
                  <div>
                    <p className="text-sm font-medium capitalize">{tx.type}</p>
                    <p className="text-xs text-muted-foreground">{tx.party?.name || 'No party'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums">{formatINR(tx.totalAmount)}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeTime(tx.date)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent AI usage */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">Recent AI Calls (last 10)</h2>
        {data.recentAiUsage.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No AI calls yet</p>
        ) : (
          <div className="space-y-2">
            {data.recentAiUsage.map((call: any) => (
              <div key={call.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${call.success ? 'bg-success' : 'bg-destructive'}`} />
                  <div>
                    <p className="text-sm font-medium capitalize">{call.feature.replace('-', ' ')}</p>
                    <p className="text-xs text-muted-foreground">{call.provider} · {call.model}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">{formatNumber(call.totalTokens)} tokens</p>
                  <p className="text-xs text-muted-foreground">{formatINR(call.costInr)} · {formatRelativeTime(call.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
