'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Users, Plus, X, Save, Loader2, Trash2, ShieldCheck,
  Shield, Eye, TrendingUp, Clock, Lock, AlertCircle, UserCog,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatRelativeTime, formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'list'

const ROLE_CONFIG: Record<string, { icon: any; color: string; badge: 'danger' | 'info' | 'neutral'; label: string }> = {
  founder: { icon: ShieldCheck, color: 'text-red-600', badge: 'danger', label: 'Founder' },
  admin: { icon: Shield, color: 'text-blue-600', badge: 'info', label: 'Admin' },
  viewer: { icon: Eye, color: 'text-slate-600', badge: 'neutral', label: 'Viewer' },
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [showEditor, setShowEditor] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-admin-users-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/admin-users?tab=overview')
      if (r.status === 403) { setAccessDenied(true); return { success: false } }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['admin-admin-users-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/admin-users?tab=list')
      if (r.status === 403) { setAccessDenied(true); return { success: false } }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'list' && !accessDenied,
    staleTime: 30 * 1000,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const r = await fetch(`/api/admin/admin-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`)
      return result
    },
    onSuccess: () => {
      toast.success('Admin user updated')
      queryClient.invalidateQueries({ queryKey: ['admin-admin-users-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-admin-users-overview'] })
    },
    onError: (err: Error) => toast.error('Update failed', { description: err.message }),
  })

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch('/api/admin/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`)
      return result
    },
    onSuccess: () => {
      toast.success('Admin user created')
      setShowEditor(false)
      queryClient.invalidateQueries({ queryKey: ['admin-admin-users-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-admin-users-overview'] })
    },
    onError: (err: Error) => toast.error('Create failed', { description: err.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/admin-users/${id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Admin user deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-admin-users-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-admin-users-overview'] })
    },
    onError: (err: Error) => toast.error('Delete failed', { description: err.message }),
  })

  if (accessDenied) {
    return (
      <div className="p-6">
        <PageHeader title="Admin Team" description="Manage admin users and their roles" />
        <EmptyState
          icon={Lock}
          title="Access Denied"
          description="Only founders can manage the admin team. Your role doesn't have permission to view this page."
        />
      </div>
    )
  }

  const ov = overview?.overview || {}
  const admins = listData?.admins || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Admin Team"
        description="Manage admin users · 3 roles (founder/admin/viewer) · 2FA status · last login"
        actions={
          <button
            onClick={() => setShowEditor(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            New Admin
          </button>
        }
      />

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
          { id: 'list' as const, label: 'All Admins', icon: Users },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <>
          {overviewLoading ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
                    <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                    <div className="h-6 bg-muted rounded w-3/4" />
                  </div>
                ))}
              </div>
              <LoadingSkeleton rows={4} />
            </>
          ) : !overview?.success ? (
            <EmptyState icon={AlertCircle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard label="Founders" value={formatNumber(ov.founderCount || 0)} icon={ShieldCheck} iconColor="text-red-600" sublabel="Full access" />
                <KPICard label="Admins" value={formatNumber(ov.adminCount || 0)} icon={Shield} iconColor="text-blue-600" sublabel="Standard access" />
                <KPICard label="Viewers" value={formatNumber(ov.viewerCount || 0)} icon={Eye} iconColor="text-slate-600" sublabel="Read-only access" />
                <KPICard label="2FA Enabled" value={formatNumber(ov.twoFACount || 0)} icon={Lock} iconColor="text-emerald-600" sublabel={`${ov.totalCount || 0} total admins`} />
              </KPIGrid>

              {/* Role descriptions */}
              <ContentCard title="Role Permissions">
                <div className="p-4 space-y-3">
                  {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
                    const Icon = cfg.icon
                    const perms = {
                      founder: ['Full access to everything', 'Can manage admin team', 'Can create/delete other admins', 'Cannot be deleted or modified by others'],
                      admin: ['Access to all admin pages', 'Can create/edit/delete data', 'Cannot manage admin team', 'Cannot modify founder accounts'],
                      viewer: ['Read-only access to all pages', 'Cannot create/edit/delete anything', 'Can view reports + analytics', 'Useful for auditors/investors'],
                    }
                    return (
                      <div key={key} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg border border-border">
                        <Icon className={`w-5 h-5 mt-0.5 ${cfg.color}`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium">{cfg.label}</p>
                            <Badge variant={cfg.badge}>{key}</Badge>
                          </div>
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                            {(perms as any)[key].map((p: string, i: number) => <li key={i}>• {p}</li>)}
                          </ul>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ContentCard>

              {/* Security note */}
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
                <div className="flex items-start gap-2">
                  <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Security Best Practices</p>
                    <ul className="text-xs text-amber-700 dark:text-amber-300 mt-1 space-y-0.5">
                      <li>• Only grant <strong>founder</strong> role to co-founders (irrevocable without DB access)</li>
                      <li>• Use <strong>viewer</strong> role for auditors, investors, consultants (read-only)</li>
                      <li>• Enforce 2FA for all admins (Settings → 2FA)</li>
                      <li>• Deactivate (don't delete) former employees — keeps audit trail</li>
                      <li>• Review admin list monthly for unused accounts</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* LIST TAB */}
      {tab === 'list' && (
        <ContentCard title={`Admin Users — ${admins.length} total`}>
          {listLoading ? (
            <LoadingSkeleton rows={6} />
          ) : admins.length === 0 ? (
            <EmptyState icon={Users} title="No admin users" />
          ) : (
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Role</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">2FA</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Last Login</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {admins.map((a: any) => {
                  const cfg = ROLE_CONFIG[a.role] || ROLE_CONFIG.viewer
                  const Icon = cfg.icon
                  return (
                    <tr key={a.id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserCog className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{a.name}</p>
                            <p className="text-xs text-muted-foreground">{a.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {a.role === 'founder' ? (
                          <Badge variant="danger"><ShieldCheck className="w-3 h-3 inline mr-1" />Founder</Badge>
                        ) : (
                          <select
                            value={a.role}
                            onChange={(e) => updateMutation.mutate({ id: a.id, role: e.target.value })}
                            disabled={updateMutation.isPending}
                            className="px-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="admin">Admin</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => updateMutation.mutate({ id: a.id, isActive: !a.isActive })}
                          disabled={updateMutation.isPending || a.role === 'founder'}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${a.isActive ? 'bg-emerald-500' : 'bg-muted'} disabled:opacity-50`}
                        >
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${a.isActive ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {a.totpEnabled ? (
                          <Badge variant="success"><Lock className="w-3 h-3 inline mr-1" />Enabled</Badge>
                        ) : (
                          <Badge variant="warning">Disabled</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {a.lastLoginAt ? formatRelativeTime(a.lastLoginAt) : 'Never'}
                        {a.lastLoginIp && <p className="font-mono text-[10px]">{a.lastLoginIp}</p>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.role !== 'founder' && (
                          <button
                            onClick={() => { if (confirm(`Delete admin "${a.name}"? This cannot be undone.`)) deleteMutation.mutate(a.id) }}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </ContentCard>
      )}

      {/* EDITOR MODAL */}
      {showEditor && (
        <AdminEditor
          onClose={() => setShowEditor(false)}
          onCreate={(data) => createMutation.mutate(data)}
          saving={createMutation.isPending}
        />
      )}
    </div>
  )
}

function AdminEditor({ onClose, onCreate, saving }: { onClose: () => void; onCreate: (data: any) => void; saving: boolean }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')

  const handleCreate = () => {
    if (!email.trim() || !name.trim() || !password.trim()) { toast.error('All fields are required'); return }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    onCreate({ email, name, password, role })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-md z-[101]" style={{ backgroundColor: '#ffffff', color: '#0f172a' }}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>New Admin User</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@bahikhata.pro" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Password * (min 8 chars)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Strong password" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Role *</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="admin">Admin (full access, cannot manage team)</option>
              <option value="viewer">Viewer (read-only, for auditors/investors)</option>
            </select>
            <p className="text-[10px] text-muted-foreground mt-0.5">Founders cannot be created via this form — only via database.</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200" style={{ backgroundColor: '#ffffff' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Create Admin
          </button>
        </div>
      </div>
    </div>
  )
}
