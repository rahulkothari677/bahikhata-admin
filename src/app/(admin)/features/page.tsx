'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Flag, Loader2, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { formatRelativeTime } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'

export default function FeaturesPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newFlag, setNewFlag] = useState({ key: '', label: '', description: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['admin-features'],
    queryFn: async () => {
      const r = await fetch('/api/admin/features')
      return r.json()
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const r = await fetch(`/api/admin/features/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(data.error || data.detail || `HTTP ${r.status}: ${r.statusText}`)
      }
      return data
    },
    onSuccess: (data) => {
      sonnerToast.success(data.message || 'Feature toggled')
      queryClient.invalidateQueries({ queryKey: ['admin-features'] })
    },
    onError: (err: Error) => {
      sonnerToast.error('Failed to toggle feature', {
        description: err.message,
        duration: 8000,
      })
    },
  })

  const createMutation = useMutation({
    mutationFn: async (flag: typeof newFlag) => {
      const r = await fetch(`/api/admin/features/${flag.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flag),
      })
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    onSuccess: () => {
      sonnerToast.success('Feature flag created')
      setShowCreate(false)
      setNewFlag({ key: '', label: '', description: '' })
      queryClient.invalidateQueries({ queryKey: ['admin-features'] })
    },
    onError: () => sonnerToast.error('Failed to create flag'),
  })

  const flags = data?.flags || []
  const filtered = search
    ? flags.filter((f: any) => f.key.includes(search) || f.label.toLowerCase().includes(search.toLowerCase()))
    : flags

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Flag className="w-6 h-6 text-blue-600" />
            Feature Flags
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Toggle features on/off instantly — no deployment needed</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          New Flag
        </button>
      </div>

      {/* Create new flag */}
      {showCreate && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Create New Feature Flag</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input placeholder="Key (e.g., 'new_dashboard')" value={newFlag.key} onChange={e => setNewFlag({ ...newFlag, key: e.target.value })} className="px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono" />
            <input placeholder="Label (e.g., 'New Dashboard')" value={newFlag.label} onChange={e => setNewFlag({ ...newFlag, label: e.target.value })} className="px-3 py-2 bg-background border border-border rounded-lg text-sm" />
            <input placeholder="Description" value={newFlag.description} onChange={e => setNewFlag({ ...newFlag, description: e.target.value })} className="px-3 py-2 bg-background border border-border rounded-lg text-sm" />
          </div>
          <button
            onClick={() => createMutation.mutate(newFlag)}
            disabled={!newFlag.key || !newFlag.label || createMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Flag'}
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search flags..."
          className="w-full pl-10 pr-3 py-2 bg-card border border-border rounded-lg text-sm"
        />
      </div>

      {/* Flags list */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Flag className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No feature flags found. Create one to get started.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((flag: any) => (
              <div key={flag.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{flag.key}</code>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${flag.enabled ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                      {flag.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <p className="text-sm font-medium mt-1">{flag.label}</p>
                  {flag.description && <p className="text-xs text-muted-foreground mt-0.5">{flag.description}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Updated {formatRelativeTime(flag.updatedAt)}
                    {flag.updatedBy && ` by ${flag.updatedBy}`}
                  </p>
                </div>
                <button
                  onClick={() => toggleMutation.mutate({ key: flag.key, enabled: !flag.enabled })}
                  disabled={toggleMutation.isPending}
                  className={`relative w-12 h-6 rounded-full transition flex-shrink-0 ml-4 ${
                    flag.enabled ? 'bg-success' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    flag.enabled ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 Feature flags take effect immediately for all users. Use them for:
          emergency kill switches, gradual rollouts, A/B testing, and beta features.
          Every toggle is logged in the audit trail.
        </p>
      </div>
    </div>
  )
}
