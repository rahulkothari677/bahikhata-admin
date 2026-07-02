/**
 * Anomaly Detection — Z-score based statistical anomaly detection.
 *
 * HOW IT WORKS:
 *   1. For each metric, fetch daily values for the last 30 days (baseline)
 *   2. Compute mean (μ) and standard deviation (σ) of the baseline
 *   3. Compare today's value to the baseline
 *   4. Z-score = (current - μ) / σ
 *   5. If |z-score| > threshold (default 2.5), it's an anomaly
 *
 * SEVERITY MAPPING:
 *   |z| 2.5-3.0  → low
 *   |z| 3.0-4.0  → medium
 *   |z| 4.0-5.0  → high
 *   |z| 5.0+     → critical
 *
 * METRICS TRACKED:
 *   - new_signups: User.count by createdAt day
 *   - active_users: distinct users with transactions/AI usage in last 24h
 *   - revenue: Subscription.amount sum by createdAt day
 *   - ai_cost: AiUsageLog.costInr sum by createdAt day
 *   - ai_calls: AiUsageLog.count by createdAt day
 *   - failed_logins: AuditLog.count(action=login_failure) by day
 *   - new_transactions: Transaction.count by createdAt day
 *   - support_tickets: SupportTicket.count by createdAt day
 */

import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface MetricConfig {
  key: string
  label: string
  description: string
  // Higher is "bad" (e.g., failed_logins, ai_cost spike) → direction=spike is concerning
  // Higher is "good" (e.g., new_signups) → direction=spike is positive, direction=drop is concerning
  higherIsBetter: boolean
  // Fetch daily values for the last N days
  fetchDailyValues: (days: number) => Promise<Array<{ date: string; value: number }>>
}

export interface AnomalyDetectionResult {
  metric: string
  metricLabel: string
  currentValue: number
  baselineValue: number
  baselineStdDev: number
  zScore: number
  direction: 'spike' | 'drop'
  severity: 'low' | 'medium' | 'high' | 'critical'
  windowStart: Date
  windowEnd: Date
  isAnomaly: boolean
}

// =====================================================================
// METRIC CONFIGURATIONS
// =====================================================================

const METRICS: MetricConfig[] = [
  {
    key: 'new_signups',
    label: 'New User Signups',
    description: 'Daily new user registrations',
    higherIsBetter: true,
    fetchDailyValues: async (days: number) => {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const result = await withTimeout(
        db.$queryRaw`
          SELECT DATE("createdAt") as date, COUNT(*)::int as value
          FROM "User"
          WHERE "createdAt" >= ${startDate}
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,
        10000
      ).catch(() => [])
      return (result as any[]).map(r => ({ date: r.date.toISOString(), value: r.value }))
    },
  },
  {
    key: 'revenue',
    label: 'Daily Revenue',
    description: 'Sum of subscription amounts per day',
    higherIsBetter: true,
    fetchDailyValues: async (days: number) => {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const result = await withTimeout(
        db.$queryRaw`
          SELECT DATE("createdAt") as date, COALESCE(SUM("amount"), 0)::float as value
          FROM "Subscription"
          WHERE "createdAt" >= ${startDate}
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,
        10000
      ).catch(() => [])
      return (result as any[]).map(r => ({ date: r.date.toISOString(), value: r.value }))
    },
  },
  {
    key: 'ai_cost',
    label: 'AI Cost (₹)',
    description: 'Daily AI API costs in INR',
    higherIsBetter: false,
    fetchDailyValues: async (days: number) => {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const result = await withTimeout(
        db.$queryRaw`
          SELECT DATE("createdAt") as date, COALESCE(SUM("costInr"), 0)::float as value
          FROM "AiUsageLog"
          WHERE "createdAt" >= ${startDate}
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,
        10000
      ).catch(() => [])
      return (result as any[]).map(r => ({ date: r.date.toISOString(), value: r.value }))
    },
  },
  {
    key: 'ai_calls',
    label: 'AI API Calls',
    description: 'Daily AI API call count',
    higherIsBetter: false,
    fetchDailyValues: async (days: number) => {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const result = await withTimeout(
        db.$queryRaw`
          SELECT DATE("createdAt") as date, COUNT(*)::int as value
          FROM "AiUsageLog"
          WHERE "createdAt" >= ${startDate}
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,
        10000
      ).catch(() => [])
      return (result as any[]).map(r => ({ date: r.date.toISOString(), value: r.value }))
    },
  },
  {
    key: 'failed_logins',
    label: 'Failed Login Attempts',
    description: 'Daily failed login count (brute force indicator)',
    higherIsBetter: false,
    fetchDailyValues: async (days: number) => {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const result = await withTimeout(
        db.$queryRaw`
          SELECT DATE("createdAt") as date, COUNT(*)::int as value
          FROM "AuditLog"
          WHERE "action" = 'login_failure' AND "createdAt" >= ${startDate}
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,
        10000
      ).catch(() => [])
      return (result as any[]).map(r => ({ date: r.date.toISOString(), value: r.value }))
    },
  },
  {
    key: 'new_transactions',
    label: 'New Transactions',
    description: 'Daily transaction count (app usage indicator)',
    higherIsBetter: true,
    fetchDailyValues: async (days: number) => {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const result = await withTimeout(
        db.$queryRaw`
          SELECT DATE("createdAt") as date, COUNT(*)::int as value
          FROM "Transaction"
          WHERE "createdAt" >= ${startDate}
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,
        10000
      ).catch(() => [])
      return (result as any[]).map(r => ({ date: r.date.toISOString(), value: r.value }))
    },
  },
  {
    key: 'support_tickets',
    label: 'New Support Tickets',
    description: 'Daily support ticket count (user frustration indicator)',
    higherIsBetter: false,
    fetchDailyValues: async (days: number) => {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const result = await withTimeout(
        db.$queryRaw`
          SELECT DATE("createdAt") as date, COUNT(*)::int as value
          FROM "SupportTicket"
          WHERE "createdAt" >= ${startDate}
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,
        10000
      ).catch(() => [])
      return (result as any[]).map(r => ({ date: r.date.toISOString(), value: r.value }))
    },
  },
]

// =====================================================================
// STATISTICAL HELPERS
// =====================================================================

function computeStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  const stdDev = Math.sqrt(variance)
  return { mean, stdDev }
}

function computeZScore(current: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0 // no variance in baseline → can't compute z-score
  return (current - mean) / stdDev
}

function getSeverity(absZScore: number): 'low' | 'medium' | 'high' | 'critical' {
  if (absZScore >= 5) return 'critical'
  if (absZScore >= 4) return 'high'
  if (absZScore >= 3) return 'medium'
  return 'low'
}

// =====================================================================
// MAIN DETECTION FUNCTION
// =====================================================================

const Z_SCORE_THRESHOLD = 2.5 // |z| > 2.5 = anomaly
const BASELINE_DAYS = 30

export async function detectAnomalies(): Promise<{
  results: AnomalyDetectionResult[]
  newAnomalies: number
  totalMetricsChecked: number
  durationMs: number
}> {
  const startTime = Date.now()
  const results: AnomalyDetectionResult[] = []

  for (const metric of METRICS) {
    try {
      // Fetch daily values for baseline
      const dailyValues = await metric.fetchDailyValues(BASELINE_DAYS)

      if (dailyValues.length < 7) {
        // Not enough data for baseline (need at least 7 days)
        continue
      }

      // Use all but the last day as baseline; last day is "current"
      const baselineValues = dailyValues.slice(0, -1).map(d => d.value)
      const currentDay = dailyValues[dailyValues.length - 1]

      if (!currentDay) continue

      const { mean, stdDev } = computeStats(baselineValues)
      const zScore = computeZScore(currentDay.value, mean, stdDev)
      const absZ = Math.abs(zScore)

      const isAnomaly = absZ > Z_SCORE_THRESHOLD && stdDev > 0

      // Determine direction (spike = higher than baseline, drop = lower)
      const direction: 'spike' | 'drop' = currentDay.value > mean ? 'spike' : 'drop'

      const result: AnomalyDetectionResult = {
        metric: metric.key,
        metricLabel: metric.label,
        currentValue: currentDay.value,
        baselineValue: Math.round(mean * 100) / 100,
        baselineStdDev: Math.round(stdDev * 100) / 100,
        zScore: Math.round(zScore * 100) / 100,
        direction,
        severity: getSeverity(absZ),
        windowStart: new Date(currentDay.date),
        windowEnd: new Date(),
        isAnomaly,
      }

      results.push(result)
    } catch (error) {
      console.error(`[anomaly] Failed to check metric ${metric.key}:`, error)
      // Continue to next metric — one failure shouldn't stop all checks
    }
  }

  // Save new anomalies to DB (only if not already detected in last 24h for same metric)
  let newAnomalies = 0
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  for (const result of results) {
    if (!result.isAnomaly) continue

    try {
      // Check if we already have an open anomaly for this metric in last 24h
      const existing = await withTimeout(
        db.anomaly.findFirst({
          where: {
            metric: result.metric,
            status: 'open',
            detectedAt: { gte: twentyFourHoursAgo },
          },
          select: { id: true },
        }),
        5000
      ).catch(() => null)

      if (existing) continue // Already detected, skip

      // Create new anomaly record
      await db.anomaly.create({
        data: {
          metric: result.metric,
          metricLabel: result.metricLabel,
          direction: result.direction,
          severity: result.severity,
          currentValue: result.currentValue,
          baselineValue: result.baselineValue,
          baselineStdDev: result.baselineStdDev,
          zScore: result.zScore,
          baselineDays: BASELINE_DAYS,
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
        },
      })
      newAnomalies++
    } catch (error) {
      console.error(`[anomaly] Failed to save anomaly for ${result.metric}:`, error)
    }
  }

  return {
    results,
    newAnomalies,
    totalMetricsChecked: results.length,
    durationMs: Date.now() - startTime,
  }
}

// =====================================================================
// METRIC CONFIG EXPORT (for UI display)
// =====================================================================

export function getMetricConfigs() {
  return METRICS.map(m => ({
    key: m.key,
    label: m.label,
    description: m.description,
    higherIsBetter: m.higherIsBetter,
  }))
}
