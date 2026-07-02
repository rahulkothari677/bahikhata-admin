/**
 * Resilience Layer — "Never Crash" Guarantee
 *
 * Every database query in the admin panel goes through these wrappers.
 * They ensure:
 *   1. Queries timeout after 5 seconds (no hanging)
 *   2. Errors are caught and return safe defaults (no crashes)
 *   3. Results are validated (no negative counts, no NaN, no Infinity)
 *   4. Database health is monitored
 *
 * Usage:
 *   import { safeQuery, safeCount, safeAggregate } from '@/lib/resilience'
 *   const userCount = await safeCount(() => db.user.count())
 *   const revenue = await safeAggregate(
 *     () => db.subscription.aggregate({ _sum: { amount: true } }),
 *     'amount'
 *   )
 */

// ===== QUERY TIMEOUT =====
/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within
 * `ms` milliseconds, rejects with a timeout error.
 *
 * At scale, a single slow query can block the entire serverless function.
 * This ensures no query takes more than 5 seconds.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
    ),
  ])
}

// ===== SAFE COUNT =====
/**
 * Wraps a count() query with:
 *   - 5 second timeout
 *   - Error catching (returns 0 on failure)
 *   - Result validation (must be non-negative integer)
 *
 * Returns: { value: number, verified: boolean, error?: string }
 */
export async function safeCount(
  fn: () => Promise<number>,
  label?: string
): Promise<{ value: number; verified: boolean; error?: string }> {
  try {
    const result = await withTimeout(fn())
    // Validate: must be a non-negative integer
    if (typeof result !== 'number' || isNaN(result) || !isFinite(result) || result < 0) {
      console.warn(`[resilience] Invalid count for "${label}": ${result}`)
      return { value: 0, verified: false, error: `Invalid value: ${result}` }
    }
    return { value: Math.floor(result), verified: true }
  } catch (error) {
    console.warn(`[resilience] Count failed for "${label}":`, error instanceof Error ? error.message : String(error))
    return { value: 0, verified: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ===== SAFE AGGREGATE =====
/**
 * Wraps an aggregate() query with:
 *   - 5 second timeout
 *   - Error catching (returns 0 on failure)
 *   - Result validation (must be non-negative number)
 *
 * Extracts the sum from the aggregate result.
 */
export async function safeAggregate(
  fn: () => Promise<any>,
  field: string,
  label?: string
): Promise<{ value: number; verified: boolean; error?: string }> {
  try {
    const result = await withTimeout(fn())
    const value = result?._sum?.[field] ?? 0
    // Validate: must be a non-negative finite number
    if (typeof value !== 'number' || isNaN(value) || !isFinite(value) || value < 0) {
      console.warn(`[resilience] Invalid aggregate for "${label}": ${value}`)
      return { value: 0, verified: false, error: `Invalid value: ${value}` }
    }
    return { value: Math.round(value * 100) / 100, verified: true } // round to 2 decimal places
  } catch (error) {
    console.warn(`[resilience] Aggregate failed for "${label}":`, error instanceof Error ? error.message : String(error))
    return { value: 0, verified: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ===== SAFE FIND MANY =====
/**
 * Wraps a findMany() query with:
 *   - 5 second timeout
 *   - Error catching (returns empty array on failure)
 *   - Result validation (must be an array)
 *
 * Always use with take/skip for pagination — never fetch unbounded data.
 */
export async function safeFindMany<T>(
  fn: () => Promise<T[]>,
  label?: string
): Promise<{ value: T[]; verified: boolean; error?: string }> {
  try {
    const result = await withTimeout(fn())
    if (!Array.isArray(result)) {
      console.warn(`[resilience] Invalid findMany for "${label}": not an array`)
      return { value: [], verified: false, error: 'Result is not an array' }
    }
    return { value: result, verified: true }
  } catch (error) {
    console.warn(`[resilience] FindMany failed for "${label}":`, error instanceof Error ? error.message : String(error))
    return { value: [], verified: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ===== DATABASE HEALTH CHECK =====
/**
 * Quick health check — runs a simple SELECT 1 to verify DB is reachable.
 * Returns true if DB is healthy, false if not.
 *
 * Use this at the top of any API route to fail fast if DB is down.
 */
export async function checkDbHealth(): Promise<boolean> {
  try {
    // Import db lazily to avoid circular dependencies
    const { db } = await import('@/lib/db')
    await withTimeout(db.$queryRaw`SELECT 1`, 3000)
    return true
  } catch {
    return false
  }
}

// ===== DATA VALIDATION =====
/**
 * Validates that a computed stat matches the live database value.
 * Used by the /api/admin/validate-data endpoint.
 *
 * Returns: { label, displayed, actual, match, discrepancy }
 */
export interface ValidationResult {
  label: string
  displayed: number  // value shown on dashboard (from DailyStats)
  actual: number     // value from live count()
  match: boolean
  discrepancy: number // actual - displayed
}

export function validateStat(label: string, displayed: number, actual: number): ValidationResult {
  const discrepancy = actual - displayed
  return {
    label,
    displayed,
    actual,
    match: Math.abs(discrepancy) <= Math.max(1, displayed * 0.001), // 0.1% tolerance
    discrepancy,
  }
}
