'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  CheckCircle2, AlertTriangle, XCircle, Wrench, Activity,
  Database, Globe, CreditCard, Cpu, Clock, RefreshCw,
} from 'lucide-react'

// =====================================================================
// PUBLIC STATUS PAGE — No auth required
// =====================================================================
// This page is accessible at /status by anyone (investors, users, monitoring tools).
// It shows real-time service health + incident history.
// Auto-refreshes every 60 seconds.
// =====================================================================

const OVERALL_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: any }> = {
  operational: {
    label: 'All Systems Operational',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50 border-emerald-200',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Degraded Performance',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50 border-amber-200',
    icon: AlertTriangle,
  },
  partial_outage: {
    label: 'Partial Service Outage',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50 border-orange-200',
    icon: AlertTriangle,
  },
  major_outage: {
    label: 'Major Service Outage',
    color: 'text-red-700',
    bgColor: 'bg-red-50 border-red-200',
    icon: XCircle,
  },
  maintenance: {
    label: 'Under Maintenance',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50 border-blue-200',
    icon: Wrench,
  },
}

const SERVICE_ICONS: Record<string, any> = {
  api: Globe,
  database: Database,
  ai_providers: Cpu,
  payments: CreditCard,
}

const SEVERITY_LABELS: Record<string, { label: string; color: string }> = {
  minor: { label: 'Minor', color: 'bg-slate-100 text-slate-700' },
  major: { label: 'Major', color: 'bg-amber-100 text-amber-700' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700' },
  maintenance: { label: 'Maintenance', color: 'bg-blue-100 text-blue-700' },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  investigating: { label: 'Investigating', color: 'bg-red-100 text-red-700' },
  identified: { label: 'Identified', color: 'bg-amber-100 text-amber-700' },
  monitoring: { label: 'Monitoring', color: 'bg-blue-100 text-blue-700' },
  resolved: { label: 'Resolved', color: 'bg-emerald-100 text-emerald-700' },
}

export default function PublicStatusPage() {
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['public-status'],
    queryFn: async () => {
      const r = await fetch('/api/status')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    refetchInterval: 60 * 1000, // auto-refresh every 60s
    staleTime: 30 * 1000,
  })

  useEffect(() => {
    setLastRefreshed(new Date())
  }, [data])

  const overall = data?.overall || 'operational'
  const services = data?.services || {}
  const activeIncidents = data?.activeIncidents || []
  const recentIncidents = data?.recentIncidents || []
  const lastUpdated = data?.lastUpdated

  const config = OVERALL_CONFIG[overall] || OVERALL_CONFIG.operational
  const OverallIcon = config.icon

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">BahiKhata Pro</h1>
              <p className="text-sm text-slate-500 mt-1">System Status</p>
            </div>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 transition"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Overall status banner */}
        <div className={`rounded-xl border-2 p-6 ${config.bgColor}`}>
          <div className="flex items-center gap-4">
            {isLoading ? (
              <div className="w-12 h-12 rounded-full bg-slate-200 animate-pulse" />
            ) : (
              <OverallIcon className={`w-12 h-12 ${config.color}`} />
            )}
            <div>
              {isLoading ? (
                <>
                  <div className="h-6 w-48 bg-slate-200 rounded animate-pulse mb-2" />
                  <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
                </>
              ) : isError ? (
                <>
                  <h2 className="text-xl font-bold text-slate-700">Unable to fetch status</h2>
                  <p className="text-sm text-slate-500">Retrying automatically...</p>
                </>
              ) : (
                <>
                  <h2 className={`text-xl font-bold ${config.color}`}>{config.label}</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    {activeIncidents.length > 0
                      ? `${activeIncidents.length} active incident${activeIncidents.length > 1 ? 's' : ''}`
                      : 'No active incidents'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Service status grid */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">Services</h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {Object.entries(services).map(([key, service]: [string, any]) => {
              const Icon = SERVICE_ICONS[key] || Activity
              const statusColor = service.status === 'operational' ? 'text-emerald-600' :
                                  service.status === 'degraded' ? 'text-amber-600' :
                                  service.status === 'down' ? 'text-red-600' :
                                  'text-slate-400'
              const statusLabel = service.status === 'operational' ? 'Operational' :
                                  service.status === 'degraded' ? 'Degraded' :
                                  service.status === 'down' ? 'Down' :
                                  'Unknown'
              return (
                <div key={key} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Icon className={`w-5 h-5 ${statusColor}`} />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{service.label}</p>
                      {service.responseTimeMs > 0 && (
                        <p className="text-xs text-slate-500">{service.responseTimeMs}ms response</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      service.status === 'operational' ? 'bg-emerald-500' :
                      service.status === 'degraded' ? 'bg-amber-500' :
                      service.status === 'down' ? 'bg-red-500' :
                      'bg-slate-300'
                    } ${service.status === 'operational' ? '' : 'animate-pulse'}`} />
                    <span className={`text-sm font-medium ${statusColor}`}>{statusLabel}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Active incidents */}
        {activeIncidents.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
              Active Incidents ({activeIncidents.length})
            </h3>
            <div className="space-y-4">
              {activeIncidents.map((inc: any) => {
                const sev = SEVERITY_LABELS[inc.severity] || SEVERITY_LABELS.minor
                const stat = STATUS_LABELS[inc.status] || STATUS_LABELS.investigating
                return (
                  <div key={inc.id} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="text-base font-semibold text-slate-900">{inc.title}</h4>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${sev.color}`}>{sev.label}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${stat.color}`}>{stat.label}</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">{inc.description}</p>
                    {inc.latestUpdate && (
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <p className="text-xs text-slate-500 mb-1">Latest update:</p>
                        <p className="text-sm text-slate-700">{inc.latestUpdate.message}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {formatRelativeTime(inc.latestUpdate.createdAt)}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                      <span>Started {formatRelativeTime(inc.startedAt)}</span>
                      {inc.service !== 'all' && <span>· Affected: {inc.service}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Recent incidents (history) */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
            Incident History (Last 10)
          </h3>
          {recentIncidents.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm text-slate-600">No past incidents — all clear!</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {recentIncidents.map((inc: any) => {
                const sev = SEVERITY_LABELS[inc.severity] || SEVERITY_LABELS.minor
                return (
                  <div key={inc.id} className="p-4 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${sev.color}`}>{sev.label}</span>
                        <span className="text-xs text-emerald-600 font-medium">Resolved</span>
                      </div>
                      <p className="text-sm font-medium text-slate-900">{inc.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                        <span>{formatRelativeTime(inc.startedAt)}</span>
                        {inc.resolvedAt && (
                          <span>· Resolved {formatRelativeTime(inc.resolvedAt)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="text-center py-6">
          <p className="text-xs text-slate-400 flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" />
            {lastUpdated
              ? `Last updated ${formatRelativeTime(lastUpdated)}`
              : `Last refreshed ${formatRelativeTime(lastRefreshed.toISOString())}`}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Auto-refreshes every 60 seconds · Powered by BahiKhata Pro
          </p>
        </footer>
      </main>
    </div>
  )
}

// Inline relative time formatter (no dependency on admin lib)
function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
