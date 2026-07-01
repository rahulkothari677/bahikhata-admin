'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Rocket, Users, TrendingUp, Gift, Send, Loader2, Trash2, Megaphone } from 'lucide-react'
import { StatCard } from '@/components/admin/stat-card'
import { formatNumber, formatRelativeTime } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'

export default function GrowthPage() {
  const queryClient = useQueryClient()
  const [showNotifForm, setShowNotifForm] = useState(false)
  const [notifForm, setNotifForm] = useState({
    title: '',
    message: '',
    type: 'info',
    targetSegment: 'all',
  })

  const { data, isLoading } = useQuery({
    queryKey: ['admin-growth'],
    queryFn: async () => {
      const r = await fetch('/api/admin/growth')
      return r.json()
    },
    refetchInterval: 60000,
  })

  const { data: notifData } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => {
      const r = await fetch('/api/admin/notifications')
      return r.json()
    },
  })

  const notifMutation = useMutation({
    mutationFn: async (data: typeof notifForm) => {
      const r = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!r.ok) throw new Error('Failed to send notification')
      return r.json()
    },
    onSuccess: () => {
      sonnerToast.success('Notification sent!')
      setShowNotifForm(false)
      setNotifForm({ title: '', message: '', type: 'info', targetSegment: 'all' })
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
    onError: () => sonnerToast.error('Failed to send notification'),
  })

  const deleteNotif = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/notifications?id=${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    onSuccess: () => {
      sonnerToast.success('Notification removed')
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.success) return <div className="p-6 text-muted-foreground">Failed to load growth data</div>

  const { funnel, segments, referrals, growthTrend } = data

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="w-6 h-6 text-amber-600" />
            Growth Tools
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Funnel, segments, referrals, and push notifications
          </p>
        </div>
        <button
          onClick={() => setShowNotifForm(!showNotifForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition"
        >
          <Megaphone className="w-4 h-4" />
          New Notification
        </button>
      </div>

      {/* Notification Form */}
      {showNotifForm && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Send Push Notification</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              placeholder="Title (e.g., 'New Feature Available!')"
              value={notifForm.title}
              onChange={(e) => setNotifForm({ ...notifForm, title: e.target.value })}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <select
              value={notifForm.targetSegment}
              onChange={(e) => setNotifForm({ ...notifForm, targetSegment: e.target.value })}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm"
            >
              <option value="all">All Users ({formatNumber(segments.active + segments.atRisk + segments.churned + segments.new)})</option>
              <option value="active">Active Users ({formatNumber(segments.active)})</option>
              <option value="atRisk">At-Risk Users ({formatNumber(segments.atRisk)})</option>
              <option value="churned">Churned Users ({formatNumber(segments.churned)})</option>
              <option value="power">Power Users ({formatNumber(segments.power)})</option>
              <option value="new">New Users ({formatNumber(segments.new)})</option>
            </select>
          </div>
          <textarea
            placeholder="Message (e.g., 'Try our new AI bill scanner — snap any bill and AI extracts everything!')"
            value={notifForm.message}
            onChange={(e) => setNotifForm({ ...notifForm, message: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <select
            value={notifForm.type}
            onChange={(e) => setNotifForm({ ...notifForm, type: e.target.value })}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm"
          >
            <option value="info">ℹ️ Info (blue)</option>
            <option value="success">✅ Success (green)</option>
            <option value="warning">⚠️ Warning (amber)</option>
            <option value="promo">🎁 Promo (orange)</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => notifMutation.mutate(notifForm)}
              disabled={!notifForm.title || !notifForm.message || notifMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {notifMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send to {notifForm.targetSegment === 'all' ? 'All Users' : notifForm.targetSegment + ' segment'}
            </button>
            <button
              onClick={() => setShowNotifForm(false)}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Growth Rate Banner */}
      <div className={`rounded-xl border p-4 ${growthTrend.growthRate >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900' : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Signup Growth Rate (7-day)</p>
            <p className={`text-2xl font-bold mt-1 ${growthTrend.growthRate >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {growthTrend.growthRate >= 0 ? '+' : ''}{growthTrend.growthRate}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {growthTrend.last7Days} signups this week vs {growthTrend.previous7Days} last week
            </p>
          </div>
          <TrendingUp className={`w-10 h-10 ${growthTrend.growthRate >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
        </div>
      </div>

      {/* Funnel Analytics */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          User Activation Funnel
        </h2>
        <div className="space-y-3">
          {[
            { label: 'Signed Up', count: funnel.signup, pct: 100, color: 'bg-blue-500' },
            { label: 'Created First Product', count: funnel.firstProduct, pct: funnel.conversionRates.signupToProduct, color: 'bg-emerald-500' },
            { label: 'Made First Sale', count: funnel.firstSale, pct: funnel.conversionRates.productToSale, color: 'bg-amber-500' },
            { label: 'Retained 7 Days', count: funnel.retained7Days, pct: funnel.conversionRates.overallRetention, color: 'bg-violet-500' },
          ].map((stage, i) => (
            <div key={i}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium">{stage.label}</span>
                <span className="text-muted-foreground">
                  {formatNumber(stage.count)} users · {stage.pct}%
                </span>
              </div>
              <div className="h-8 bg-muted rounded-lg overflow-hidden">
                <div
                  className={`h-full ${stage.color} flex items-center justify-end px-3 transition-all`}
                  style={{ width: `${Math.max(stage.pct, 2)}%` }}
                >
                  <span className="text-white text-xs font-bold">{stage.pct}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          💡 Target: 70%+ signup→product, 50%+ product→sale, 30%+ sale→retention
        </div>
      </div>

      {/* User Segments + Referrals — 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Segments */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-500" />
            User Segments
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <SegmentCard label="Active (7d)" count={segments.active} color="text-emerald-600" bg="bg-emerald-50 dark:bg-emerald-950/20" />
            <SegmentCard label="New (7d)" count={segments.new} color="text-blue-600" bg="bg-blue-50 dark:bg-blue-950/20" />
            <SegmentCard label="At-Risk" count={segments.atRisk} color="text-amber-600" bg="bg-amber-50 dark:bg-amber-950/20" />
            <SegmentCard label="Churned" count={segments.churned} color="text-red-600" bg="bg-red-50 dark:bg-red-950/20" />
            <SegmentCard label="Power Users" count={segments.power} color="text-violet-600" bg="bg-violet-50 dark:bg-violet-950/20" />
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            💡 Send re-engagement notifications to at-risk users. Power users are your best referral source.
          </div>
        </div>

        {/* Referrals */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Gift className="w-4 h-4 text-amber-500" />
            Referral Program
          </h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center">
              <p className="text-xl font-bold">{referrals.total}</p>
              <p className="text-[10px] text-muted-foreground">Total</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-emerald-600">{referrals.completed}</p>
              <p className="text-[10px] text-muted-foreground">Completed</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-amber-600">{referrals.kFactor}</p>
              <p className="text-[10px] text-muted-foreground">K-Factor</p>
            </div>
          </div>
          {referrals.isViral ? (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-2 text-center">
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                🚀 Viral! K-Factor ≥ 1.0 — each user brings 1+ new users
              </p>
            </div>
          ) : (
            <div className="bg-muted/50 rounded-lg p-2 text-center">
              <p className="text-xs text-muted-foreground">
                K-Factor {referrals.kFactor} — need 1.0+ for viral growth
              </p>
            </div>
          )}
          {referrals.topReferrers.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase">Top Referrers</p>
              {referrals.topReferrers.map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs py-1">
                  <span>{r.user?.name || r.user?.email || 'Unknown'}</span>
                  <span className="font-bold">{r._count} referrals</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Notifications */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-blue-500" />
          Sent Notifications
        </h2>
        {notifData?.announcements?.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No notifications sent yet</p>
        ) : (
          <div className="space-y-2">
            {notifData?.announcements?.map((ann: any) => (
              <div key={ann.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      ann.type === 'success' ? 'bg-emerald-500' :
                      ann.type === 'warning' ? 'bg-amber-500' :
                      ann.type === 'promo' ? 'bg-orange-500' : 'bg-blue-500'
                    }`} />
                    <p className="text-sm font-medium truncate">{ann.title}</p>
                    {!ann.isActive && <span className="text-[10px] text-muted-foreground">(inactive)</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{ann.message}</p>
                </div>
                <div className="text-right flex-shrink-0 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(ann.createdAt)}</span>
                  {ann.isActive && (
                    <button
                      onClick={() => deleteNotif.mutate(ann.id)}
                      className="p-1 text-muted-foreground hover:text-destructive transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SegmentCard({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <div className={`rounded-lg p-3 ${bg}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${color}`}>{formatNumber(count)}</p>
    </div>
  )
}
