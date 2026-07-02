/**
 * Fraud Rules Engine — evaluates admin-defined rules against user activity.
 *
 * HOW IT WORKS:
 *   1. For each ENABLED FraudRule, fetch the metric value for each user
 *   2. Apply the condition (operator + threshold)
 *   3. If condition is met, create a FraudAlert (unless one already open for this user+rule)
 *
 * METRICS SUPPORTED:
 *   - transaction_count: COUNT of transactions per user in time window
 *   - transaction_amount: SUM of transaction amounts per user in time window
 *   - ai_call_count: COUNT of AI usage logs per user in time window
 *   - login_failure_count: COUNT of failed logins per user in time window
 *   - new_user_with_activity: users created within userAgeMinutes AND with > threshold transactions
 *
 * PERFORMANCE:
 *   - Uses bulk groupBy queries (NOT per-user queries)
 *   - For 100K users with 10 rules: 10 groupBy queries total (not 1M queries)
 *   - Each query has a 10s timeout
 *   - One rule failure doesn't stop others
 */

import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface RuleEvaluationResult {
  ruleId: string
  ruleName: string
  metric: string
  alertsCreated: number
  error?: string
}

export interface EvaluationSummary {
  totalRules: number
  totalAlertsCreated: number
  results: RuleEvaluationResult[]
  durationMs: number
}

// =====================================================================
// METRIC EVALUATORS
// =====================================================================
// Each evaluator returns an array of { userId, value } for users who exceed
// the threshold. We use groupBy to do this DB-side (not per-user queries).

interface EvaluatorParams {
  threshold: number
  operator: string // gt | gte | lt | lte | eq
  windowMinutes: number | null
  userAgeMinutes?: number | null
}

interface UserMetric {
  userId: string
  value: number
}

// Build Prisma where clause for time window
function buildTimeWhere(windowMinutes: number | null, dateField: string = 'createdAt'): any {
  if (!windowMinutes) return {}
  const since = new Date(Date.now() - windowMinutes * 60 * 1000)
  return { [dateField]: { gte: since } }
}

// Build Prisma where clause for user age (createdAt within X minutes)
function buildUserAgeWhere(userAgeMinutes: number | null): any {
  if (!userAgeMinutes) return {}
  const since = new Date(Date.now() - userAgeMinutes * 60 * 1000)
  return { createdAt: { gte: since } }
}

// Apply operator filter in JS (after groupBy returns aggregates)
function matchesOperator(value: number, threshold: number, operator: string): boolean {
  switch (operator) {
    case 'gt': return value > threshold
    case 'gte': return value >= threshold
    case 'lt': return value < threshold
    case 'lte': return value <= threshold
    case 'eq': return value === threshold
    default: return false
  }
}

// =====================================================================
// TRANSACTION COUNT
// =====================================================================
async function evalTransactionCount(params: EvaluatorParams): Promise<UserMetric[]> {
  const where: any = {
    ...buildTimeWhere(params.windowMinutes, 'createdAt'),
    ...(params.userAgeMinutes ? { user: buildUserAgeWhere(params.userAgeMinutes) } : {}),
  }

  const groups = await withTimeout(
    db.transaction.groupBy({
      by: ['userId'],
      where,
      _count: true,
    }),
    10000
  ).catch(() => [])

  return (groups as any[])
    .map((g: any) => ({ userId: g.userId, value: g._count }))
    .filter((m: UserMetric) => matchesOperator(m.value, params.threshold, params.operator))
}

// =====================================================================
// TRANSACTION AMOUNT (SUM)
// =====================================================================
async function evalTransactionAmount(params: EvaluatorParams): Promise<UserMetric[]> {
  const where: any = {
    ...buildTimeWhere(params.windowMinutes, 'createdAt'),
    ...(params.userAgeMinutes ? { user: buildUserAgeWhere(params.userAgeMinutes) } : {}),
  }

  const groups = await withTimeout(
    db.transaction.groupBy({
      by: ['userId'],
      where,
      _sum: { totalAmount: true },
    }),
    10000
  ).catch(() => [])

  return (groups as any[])
    .map((g: any) => ({ userId: g.userId, value: g._sum.totalAmount || 0 }))
    .filter((m: UserMetric) => matchesOperator(m.value, params.threshold, params.operator))
}

// =====================================================================
// AI CALL COUNT
// =====================================================================
async function evalAiCallCount(params: EvaluatorParams): Promise<UserMetric[]> {
  const where: any = {
    ...buildTimeWhere(params.windowMinutes, 'createdAt'),
    ...(params.userAgeMinutes ? { user: buildUserAgeWhere(params.userAgeMinutes) } : {}),
  }

  const groups = await withTimeout(
    db.aiUsageLog.groupBy({
      by: ['userId'],
      where,
      _count: true,
    }),
    10000
  ).catch(() => [])

  return (groups as any[])
    .map((g: any) => ({ userId: g.userId, value: g._count }))
    .filter((m: UserMetric) => matchesOperator(m.value, params.threshold, params.operator))
}

// =====================================================================
// LOGIN FAILURE COUNT
// =====================================================================
async function evalLoginFailureCount(params: EvaluatorParams): Promise<UserMetric[]> {
  const where: any = {
    action: 'login_failure',
    ...buildTimeWhere(params.windowMinutes, 'createdAt'),
    // AuditLog doesn't have a direct user relation for failures (failures are by IP, not user)
    // So we group by IP instead. We'll create alerts per IP.
  }

  const groups = await withTimeout(
    db.auditLog.groupBy({
      by: ['ip'],
      where,
      _count: true,
    }),
    10000
  ).catch(() => [])

  // For login failures, "userId" is actually the IP address
  return (groups as any[])
    .map((g: any) => ({ userId: g.ip || 'unknown', value: g._count }))
    .filter((m: UserMetric) => matchesOperator(m.value, params.threshold, params.operator))
}

// =====================================================================
// NEW USER WITH ACTIVITY
// =====================================================================
// Users created within userAgeMinutes AND with > threshold transactions
async function evalNewUserWithActivity(params: EvaluatorParams): Promise<UserMetric[]> {
  if (!params.userAgeMinutes) {
    // Without userAgeMinutes, this metric doesn't make sense
    return []
  }

  const userSince = new Date(Date.now() - params.userAgeMinutes * 60 * 1000)
  const txSince = params.windowMinutes
    ? new Date(Date.now() - params.windowMinutes * 60 * 1000)
    : new Date(0) // all-time

  // Find new users (created within userAgeMinutes)
  const newUsers = await withTimeout(
    db.user.findMany({
      where: { createdAt: { gte: userSince } },
      select: { id: true, name: true, email: true },
    }),
    10000
  ).catch(() => [])

  if (newUsers.length === 0) return []

  // Get transaction counts for these new users in the time window
  const CHUNK = 5000
  const results: UserMetric[] = []
  for (let i = 0; i < newUsers.length; i += CHUNK) {
    const chunk = newUsers.slice(i, i + CHUNK)
    const groups = await withTimeout(
      db.transaction.groupBy({
        by: ['userId'],
        where: {
          userId: { in: chunk.map(u => u.id) },
          createdAt: { gte: txSince },
        },
        _count: true,
      }),
      10000
    ).catch(() => [])

    for (const g of groups as any[]) {
      if (matchesOperator(g._count, params.threshold, params.operator)) {
        results.push({ userId: g.userId, value: g._count })
      }
    }
  }

  return results
}

// =====================================================================
// MAIN EVALUATOR
// =====================================================================

const METRIC_EVALUATORS: Record<string, (params: EvaluatorParams) => Promise<UserMetric[]>> = {
  transaction_count: evalTransactionCount,
  transaction_amount: evalTransactionAmount,
  ai_call_count: evalAiCallCount,
  login_failure_count: evalLoginFailureCount,
  new_user_with_activity: evalNewUserWithActivity,
}

export const METRIC_CONFIGS = [
  {
    key: 'transaction_count',
    label: 'Transaction Count',
    description: 'Number of transactions per user in the time window',
    exampleThreshold: '50',
    exampleWindow: '60 (1 hour)',
  },
  {
    key: 'transaction_amount',
    label: 'Transaction Amount (₹)',
    description: 'Total transaction amount per user in the time window',
    exampleThreshold: '100000',
    exampleWindow: '1440 (24 hours)',
  },
  {
    key: 'ai_call_count',
    label: 'AI Call Count',
    description: 'Number of AI API calls per user in the time window',
    exampleThreshold: '20',
    exampleWindow: '60 (1 hour)',
  },
  {
    key: 'login_failure_count',
    label: 'Login Failure Count (by IP)',
    description: 'Failed login attempts per IP address (brute force detection)',
    exampleThreshold: '10',
    exampleWindow: '60 (1 hour)',
  },
  {
    key: 'new_user_with_activity',
    label: 'New User with High Activity',
    description: 'Users created within X minutes who have > threshold transactions (bot detection)',
    exampleThreshold: '10',
    exampleWindow: '60 (1 hour)',
    requiresUserAge: true,
  },
]

export const OPERATOR_CONFIGS = [
  { key: 'gt', label: 'Greater than (>)' },
  { key: 'gte', label: 'Greater than or equal (≥)' },
  { key: 'lt', label: 'Less than (<)' },
  { key: 'lte', label: 'Less than or equal (≤)' },
  { key: 'eq', label: 'Equal to (=)' },
]

export async function evaluateAllRules(): Promise<EvaluationSummary> {
  const startTime = Date.now()

  // Fetch all enabled rules
  const rules = await withTimeout(
    db.fraudRule.findMany({ where: { enabled: true } }),
    5000
  ).catch(() => [])

  if (rules.length === 0) {
    return {
      totalRules: 0,
      totalAlertsCreated: 0,
      results: [],
      durationMs: Date.now() - startTime,
    }
  }

  const results: RuleEvaluationResult[] = []
  let totalAlertsCreated = 0

  for (const rule of rules) {
    const evaluator = METRIC_EVALUATORS[rule.metric]
    if (!evaluator) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        alertsCreated: 0,
        error: `Unknown metric: ${rule.metric}`,
      })
      continue
    }

    try {
      // Evaluate the rule
      const userMetrics = await evaluator({
        threshold: rule.threshold,
        operator: rule.operator,
        windowMinutes: rule.windowMinutes,
        userAgeMinutes: rule.userAgeMinutes,
      })

      let alertsCreated = 0

      // Create alerts for each matching user (skip if already open)
      for (const um of userMetrics) {
        try {
          // Check if there's already an open alert for this user + rule
          const existing = await withTimeout(
            db.fraudAlert.findFirst({
              where: {
                ruleId: rule.id,
                userId: um.userId,
                status: 'open',
              },
              select: { id: true },
            }),
            5000
          ).catch(() => null)

          if (existing) continue // Already alerted, skip

          // Fetch user details (for snapshot in alert)
          let userName: string | null = null
          let userEmail: string | null = null
          if (rule.metric !== 'login_failure_count') {
            const user = await withTimeout(
              db.user.findUnique({
                where: { id: um.userId },
                select: { name: true, email: true },
              }),
              5000
            ).catch(() => null)
            userName = user?.name || null
            userEmail = user?.email || null
          }

          await db.fraudAlert.create({
            data: {
              ruleId: rule.id,
              userId: um.userId,
              userName,
              userEmail,
              metricValue: um.value,
              threshold: rule.threshold,
              status: 'open',
            },
          })
          alertsCreated++
        } catch (error) {
          console.error(`[fraud] Failed to create alert for user ${um.userId}:`, error)
        }
      }

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        alertsCreated,
      })
      totalAlertsCreated += alertsCreated
    } catch (error) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        alertsCreated: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    totalRules: rules.length,
    totalAlertsCreated,
    results,
    durationMs: Date.now() - startTime,
  }
}
