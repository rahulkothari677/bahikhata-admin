'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Database, Play, Download, Loader2, AlertTriangle,
  Table, HardDrive, FileBarChart, ShieldCheck, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, KPIGrid, KPICard, ContentCard, EmptyState,
  LoadingSkeleton, Badge,
} from '@/components/admin/ui'
import { formatNumber } from '@/lib/utils'

type Tab = 'overview' | 'query' | 'tables'

const EXAMPLE_QUERIES = [
  { label: 'Count users by plan', sql: 'SELECT plan, COUNT(*) as count FROM "User" GROUP BY plan ORDER BY count DESC' },
  { label: 'Recent 10 users', sql: 'SELECT id, email, name, plan, "createdAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 10' },
  { label: 'AI cost last 7 days', sql: 'SELECT DATE("createdAt") as date, SUM("costInr") as cost FROM "AiUsageLog" WHERE "createdAt" >= NOW() - INTERVAL \'7 days\' GROUP BY DATE("createdAt") ORDER BY date DESC' },
  { label: 'Active subscriptions', sql: 'SELECT plan, COUNT(*) as count, SUM(amount) as total_revenue FROM "Subscription" WHERE status = \'active\' GROUP BY plan' },
  { label: 'Table row counts', sql: 'SELECT relname as table_name, n_live_tup as row_count FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20' },
]

export default function DatabaseAdminPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [sql, setSql] = useState('')
  const [queryResult, setQueryResult] = useState<any>(null)

  // ============ OVERVIEW DATA ============
  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-database-overview'],
    queryFn: async () => {
      const r = await fetch('/api/admin/database?tab=overview')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // ============ TABLES DATA ============
  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: ['admin-database-tables'],
    queryFn: async () => {
      const r = await fetch('/api/admin/database?tab=tables')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: tab === 'tables',
    staleTime: 60 * 1000,
  })

  // ============ QUERY MUTATION ============
  const queryMutation = useMutation({
    mutationFn: async (sqlText: string) => {
      const r = await fetch('/api/admin/database/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlText }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      return data
    },
    onSuccess: (data) => {
      setQueryResult(data.result)
      toast.success(`Query executed — ${data.result.rowCount} rows in ${data.result.durationMs}ms`)
    },
    onError: (err: Error) => {
      toast.error('Query failed', { description: err.message })
      setQueryResult(null)
    },
  })

  // ============ EXPORT MUTATION ============
  const exportMutation = useMutation({
    mutationFn: async (sqlText: string) => {
      const r = await fetch('/api/admin/database/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlText }),
      })
      if (!r.ok) {
        const data = await r.json()
        throw new Error(data.error || `HTTP ${r.status}`)
      }
      return r.blob()
    },
    onSuccess: (blob) => {
      // Download the CSV file
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('CSV downloaded')
    },
    onError: (err: Error) => {
      toast.error('Export failed', { description: err.message })
    },
  })

  const handleRunQuery = () => {
    if (!sql.trim()) {
      toast.error('Enter a SQL query first')
      return
    }
    queryMutation.mutate(sql)
  }

  const handleExport = () => {
    if (!sql.trim()) {
      toast.error('Enter a SQL query first')
      return
    }
    exportMutation.mutate(sql)
  }

  const ov = overviewData?.overview || {}
  const tables = overviewData?.tables || []
  const allTables = tablesData?.tables || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Database Admin"
        description="Safe read-only SQL query runner · table stats · CSV export (all queries audited)"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'overview' as const, label: 'Overview', icon: FileBarChart },
          { id: 'query' as const, label: 'Query Runner', icon: Play },
          { id: 'tables' as const, label: 'All Tables', icon: Table },
        ]).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ============ OVERVIEW TAB ============ */}
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
              <LoadingSkeleton rows={6} />
            </>
          ) : !overviewData?.success ? (
            <EmptyState icon={AlertTriangle} title="Failed to load" description="Please refresh" />
          ) : (
            <>
              <KPIGrid>
                <KPICard
                  label="Total Tables"
                  value={formatNumber(ov.totalTables || 0)}
                  icon={Table}
                  iconColor="text-blue-600"
                  sublabel="In the database"
                />
                <KPICard
                  label="Total Rows"
                  value={formatNumber(ov.totalRows || 0)}
                  icon={Database}
                  iconColor="text-violet-600"
                  sublabel="Across all tables"
                />
                <KPICard
                  label="Database Size"
                  value={`${ov.totalSizeMB || 0} MB`}
                  icon={HardDrive}
                  iconColor="text-emerald-600"
                  sublabel="Disk usage"
                />
                <KPICard
                  label="Largest Table"
                  value={ov.largestTable?.name || '—'}
                  icon={FileBarChart}
                  iconColor="text-amber-600"
                  sublabel={ov.largestTable ? `${ov.largestTable.sizeMB} MB` : 'No data'}
                />
              </KPIGrid>

              {/* Top 10 tables by size */}
              <ContentCard title="Top 10 Tables by Size">
                <div className="p-4 space-y-2">
                  {tables.map((t: any, i: number) => (
                    <div key={t.name} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground w-6">#{i + 1}</span>
                        <code className="text-sm font-mono">{t.name}</code>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-muted-foreground">{formatNumber(t.rowCount)} rows</span>
                        <Badge variant={t.sizeMB > 10 ? 'warning' : 'neutral'}>
                          {t.sizeMB > 0 ? `${t.sizeMB} MB` : `${t.sizeBytes} B`}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ContentCard>

              {/* Security info */}
              <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-900 p-4">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      Read-Only Safety Guarantees
                    </p>
                    <ul className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 space-y-0.5">
                      <li>• Only SELECT queries allowed (no INSERT/UPDATE/DELETE/DROP)</li>
                      <li>• Max 1000 rows per query (prevents memory exhaustion)</li>
                      <li>• 10-second query timeout (no long-running queries)</li>
                      <li>• All queries logged to AdminAction audit trail</li>
                      <li>• Dangerous keywords blocked (DROP, ALTER, TRUNCATE, etc.)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ QUERY TAB ============ */}
      {tab === 'query' && (
        <>
          {/* SQL editor */}
          <ContentCard
            title="SQL Query Runner"
            action={
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExport}
                  disabled={exportMutation.isPending || !sql.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
                >
                  {exportMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  Export CSV
                </button>
                <button
                  onClick={handleRunQuery}
                  disabled={queryMutation.isPending || !sql.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {queryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Run Query
                </button>
              </div>
            }
          >
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  SQL Query (SELECT only)
                </label>
                <textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  rows={6}
                  placeholder={'SELECT * FROM "User" LIMIT 10'}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  spellCheck={false}
                />
              </div>

              {/* Example queries */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Example Queries:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_QUERIES.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setSql(q.sql)}
                      className="px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-md hover:bg-muted/70 transition"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </ContentCard>

          {/* Results */}
          {queryResult && (
            <ContentCard
              title={`Results — ${queryResult.rowCount} rows${queryResult.truncated ? ' (truncated, max 1000)' : ''}`}
              action={
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {queryResult.durationMs}ms
                </span>
              }
            >
              {queryResult.rows.length === 0 ? (
                <EmptyState icon={Database} title="No rows returned" description="Query executed successfully but returned 0 rows" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border sticky top-0">
                      <tr>
                        {queryResult.columns.map((col: string, i: number) => (
                          <th key={i} className="text-left text-xs font-medium text-muted-foreground uppercase px-3 py-2 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {queryResult.rows.map((row: any[], i: number) => (
                        <tr key={i} className="hover:bg-muted/30">
                          {row.map((cell: any, j: number) => (
                            <td key={j} className="px-3 py-2 text-xs font-mono whitespace-nowrap max-w-xs truncate" title={String(cell)}>
                              {cell === null ? <span className="text-muted-foreground italic">NULL</span> : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ContentCard>
          )}

          {/* Security warning */}
          <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Query Safety Rules
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-300 mt-1 space-y-0.5">
                  <li>• Only <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">SELECT</code> and <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">WITH</code> queries allowed</li>
                  <li>• Table names are case-sensitive — use double quotes: <code className="text-[11px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded">"User"</code></li>
                  <li>• Max 1000 rows returned (use LIMIT for smaller results)</li>
                  <li>• Max 10-second execution time</li>
                  <li>• All queries are logged to the audit trail</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============ TABLES TAB ============ */}
      {tab === 'tables' && (
        <ContentCard title={`All Tables — ${allTables.length} total`}>
          {tablesLoading ? (
            <LoadingSkeleton rows={15} />
          ) : allTables.length === 0 ? (
            <EmptyState icon={Table} title="No tables" description="Database appears to be empty" />
          ) : (
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">#</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Table Name</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Rows</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Size</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allTables.map((t: any, i: number) => (
                  <tr key={t.name} className="hover:bg-muted/30 transition">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-3">
                      <code className="text-sm font-mono">{t.name}</code>
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">{formatNumber(t.rowCount)}</td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant={t.sizeMB > 10 ? 'warning' : 'neutral'}>
                        {t.sizeMB > 0 ? `${t.sizeMB} MB` : `${formatNumber(t.sizeBytes)} B`}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setSql(`SELECT * FROM "${t.name}" LIMIT 10`)
                          setTab('query')
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Browse →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ContentCard>
      )}
    </div>
  )
}
