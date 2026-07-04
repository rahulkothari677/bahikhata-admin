/**
 * Database Admin Tools — safe query runner, table stats, CSV export.
 *
 * SECURITY MODEL:
 *   1. ALL queries are READ-ONLY (SELECT only — no INSERT/UPDATE/DELETE/DROP)
 *   2. Query validation: blocks dangerous keywords (DROP, DELETE, UPDATE, etc.)
 *   3. Query timeout: 10 seconds max (no long-running queries)
 *   4. Row limit: max 1000 rows returned (prevents memory exhaustion)
 *   5. All queries logged to AdminAction audit trail
 *
 * USE CASES:
 *   - Investigate data issues ("why does user X have wrong plan?")
 *   - Export data for analysis (CSV download)
 *   - Check table sizes and growth trends
 *   - Verify data integrity (count mismatches)
 */

import { dbReadonly } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface TableStats {
  name: string
  rowCount: number
  sizeBytes: number
  sizeMB: number
}

export interface QueryResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  truncated: boolean  // true if more than 1000 rows
  durationMs: number
}

// =====================================================================
// TABLE STATISTICS
// =====================================================================
// Returns row count + disk size for all tables in the database.
// Uses PostgreSQL's pg_class + pg_total_relation_size for accurate stats.

export async function getTableStats(): Promise<TableStats[]> {
  const result = await withTimeout(
    dbReadonly.$queryRaw`
      SELECT
        relname AS name,
        n_live_tup AS "rowCount",
        pg_total_relation_size(relid) AS "sizeBytes"
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
    `,
    10000
  ).catch(() => [])

  return (result as any[]).map((r: any) => ({
    name: r.name,
    rowCount: Number(r.rowCount) || 0,
    sizeBytes: Number(r.sizeBytes) || 0,
    sizeMB: Math.round((Number(r.sizeBytes) || 0) / (1024 * 1024) * 100) / 100,
  }))
}

// =====================================================================
// SAFE QUERY RUNNER
// =====================================================================
// Executes a read-only SQL query with full validation.
// Returns up to 1000 rows (truncated if more).

const MAX_ROWS = 1000
const QUERY_TIMEOUT_MS = 10000

// 🔒 AUDIT FIX C5: Strengthened SQL runner validation.
// Was: blocklist of dangerous keywords (DROP, DELETE, etc.) — bypassable.
// Now: strict whitelist — ONLY SELECT and WITH clauses allowed, plus a
// blocklist as defense-in-depth. Also blocks semicolons (no multi-statement),
// comments (could hide malicious SQL), and dangerous function calls.

// Dangerous keywords that could modify data — defense-in-depth on top of the whitelist
const BLOCKED_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE',
  'GRANT', 'REVOKE', 'COPY', 'VACUUM', 'REINDEX', 'CLUSTER', 'COMMENT',
  'EXECUTE', 'MERGE', 'REFRESH', 'REASSIGN', 'SECURITY',
  // 🔒 AUDIT FIX: also block function calls that could write/execute
  'CALL', 'DO', 'PERFORM', 'RAISE', 'NOTIFY', 'LISTEN', 'UNLISTEN',
  // Block pg_read_file, pg_ls_dir, etc. — could read filesystem
  'PG_READ_FILE', 'PG_LS_DIR', 'PG_STAT_FILE', 'PG_SLEEP',
]

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateQuery(sql: string): ValidationResult {
  const trimmed = sql.trim()

  if (!trimmed) {
    return { valid: false, error: 'Query is empty' }
  }

  // 🔒 WHITELIST: Must start with SELECT or WITH (CTE). Nothing else allowed.
  const upperQuery = trimmed.toUpperCase()
  if (!upperQuery.startsWith('SELECT') && !upperQuery.startsWith('WITH')) {
    return { valid: false, error: 'Only SELECT queries are allowed (must start with SELECT or WITH)' }
  }

  // 🔒 BLOCK COMMENTS: SQL comments (--) and /* */ can hide malicious SQL
  if (trimmed.includes('--') || trimmed.includes('/*') || trimmed.includes('*/')) {
    return { valid: false, error: 'SQL comments are not allowed' }
  }

  // Check for blocked keywords (word-boundary match to avoid false positives)
  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i')
    if (regex.test(trimmed)) {
      return { valid: false, error: `Blocked keyword detected: ${keyword}` }
    }
  }

  // Block semicolons (prevent multiple statements)
  if (trimmed.includes(';')) {
    // Allow only trailing semicolon
    if (trimmed.indexOf(';') !== trimmed.length - 1) {
      return { valid: false, error: 'Multiple statements not allowed (remove semicolons)' }
    }
  }

  return { valid: true }
}

export async function executeSafeQuery(sql: string): Promise<QueryResult> {
  const startTime = Date.now()

  // Remove trailing semicolon
  const cleanSql = sql.trim().replace(/;$/, '')

  // Execute with row limit
  // 🔒 AUDIT FIX C5 (V6): Uses dbReadonly (read-only DB role) instead of db.
  // The database itself enforces read-only — no matter what the regex misses.
  const limitedSql = `${cleanSql} LIMIT ${MAX_ROWS + 1}`
  const result = await withTimeout(
    dbReadonly.$queryRawUnsafe(limitedSql),
    QUERY_TIMEOUT_MS
  )

  const rows = result as any[]
  const truncated = rows.length > MAX_ROWS
  const finalRows = truncated ? rows.slice(0, MAX_ROWS) : rows

  // Extract column names from first row
  let columns: string[] = []
  if (finalRows.length > 0) {
    columns = Object.keys(finalRows[0])
  }

  // Convert to array of arrays for easier rendering
  const rowsArray = finalRows.map(row => columns.map(col => row[col]))

  return {
    columns,
    rows: rowsArray,
    rowCount: finalRows.length,
    truncated,
    durationMs: Date.now() - startTime,
  }
}

// =====================================================================
// CSV EXPORT
// =====================================================================

export function exportToCsv(result: QueryResult): string {
  if (result.columns.length === 0) {
    return ''
  }

  // Header row
  const header = result.columns.map(escapeCsv).join(',')
  const lines = [header]

  // Data rows
  for (const row of result.rows) {
    const line = row.map(cell => escapeCsv(cell)).join(',')
    lines.push(line)
  }

  return lines.join('\n')
}

function escapeCsv(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  // Escape quotes by doubling them, wrap in quotes if contains comma/quote/newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// =====================================================================
// DATABASE OVERVIEW
// =====================================================================

export interface DatabaseOverview {
  totalTables: number
  totalRows: number
  totalSizeMB: number
  largestTable: { name: string; sizeMB: number } | null
  tableCount: number
}

export async function getDatabaseOverview(): Promise<DatabaseOverview> {
  const stats = await getTableStats()

  const totalRows = stats.reduce((sum, s) => sum + s.rowCount, 0)
  const totalSizeMB = stats.reduce((sum, s) => sum + s.sizeMB, 0)
  const largest = stats.length > 0
    ? { name: stats[0].name, sizeMB: stats[0].sizeMB }
    : null

  return {
    totalTables: stats.length,
    totalRows,
    totalSizeMB: Math.round(totalSizeMB * 100) / 100,
    largestTable: largest,
    tableCount: stats.length,
  }
}
