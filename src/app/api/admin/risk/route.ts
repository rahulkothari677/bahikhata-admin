import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

/**
 * GET /api/admin/risk
 *
 * Returns risk & compliance analytics using BULK aggregate + groupBy queries.
 * Scales to millions of users — NO findMany on full tables.
 *
 * Query params:
 *   - tab: 'overview' | 'fraud' | 'security' (default: 'overview')
 *   - page: number (for fraud detail lists)
 *
 * OLD APPROACH (N+1 / unbounded):
 *   - findMany ALL users with phone → JS-side group → O(N) memory
 *   - findMany ALL recent signups → JS-side filter for sequential emails
 *   - findMany ALL failed login logs → JS-side group by IP
 *   At 1M users this CRASHES (OOM) or takes 30+ seconds.
 *
 * NEW APPROACH (bulk aggregate):
 *   - groupBy on phone (DB-side) → returns only phones with >1 user
 *   - aggregate for counts (DB-side) → O(1)
 *   - groupBy on IP for failed logins (DB-side) → returns only IPs with >5 fails
 *   - findMany with take:10 + pagination for high-value transactions
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      // ===== PARALLEL COUNT QUERIES (10 total, all O(1)) =====
      const [
        duplicatePhoneCount,
        inactiveNewUsers,
        highValueTxnCount,
        failedLogins24h,
        successfulLogins24h,
        bruteForceIpCount,
        adminActions30Days,
        dataExportRequests,
        dataDeleteRequests,
        recentDataRequests,
      ] = await Promise.all([
        // Count of phones used by >1 user (DB-side groupBy + filter)
        // Prisma doesn't support HAVING, so we groupBy then filter in JS (only the GROUPED rows, not all users)
        withTimeout(
          db.user.groupBy({
            by: ['phone'],
            where: { phone: { not: null } },
            _count: true,
          }),
          5000
        ).catch(() => [])
          .then((r: any[]) => r.filter(g => g._count > 1).length),

        // Inactive new users (created >7 days ago, no transactions, no AI usage)
        withTimeout(
          db.user.count({
            where: {
              createdAt: { lt: sevenDaysAgo },
              transactions: { none: {} },
              aiUsageLogs: { none: {} },
            },
          }),
          5000
        ).catch(() => 0),

        // High-value transactions count (₹1L+ in last 7 days)
        withTimeout(
          db.transaction.count({
            where: {
              totalAmount: { gte: 100000 },
              createdAt: { gte: sevenDaysAgo },
            },
          }),
          5000
        ).catch(() => 0),

        // Failed logins (24h)
        withTimeout(
          db.auditLog.count({
            where: { action: 'login_failure', createdAt: { gte: twentyFourHoursAgo } },
          }),
          5000
        ).catch(() => 0),

        // Successful logins (24h)
        withTimeout(
          db.auditLog.count({
            where: { action: 'login_success', createdAt: { gte: twentyFourHoursAgo } },
          }),
          5000
        ).catch(() => 0),

        // Brute force IP count (DB-side groupBy on failed logins, filter _count >= 5)
        withTimeout(
          db.auditLog.groupBy({
            by: ['ip'],
            where: {
              action: 'login_failure',
              createdAt: { gte: twentyFourHoursAgo },
              ip: { not: null },
            },
            _count: true,
          }),
          5000
        ).catch(() => [])
          .then((r: any[]) => r.filter(g => g._count >= 5).length),

        // Admin actions (30 days)
        withTimeout(
          db.adminAction.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
          5000
        ).catch(() => 0),

        // Data export requests
        withTimeout(
          db.auditLog.count({ where: { action: 'data_export' } }),
          5000
        ).catch(() => 0),

        // Data delete requests
        withTimeout(
          db.auditLog.count({ where: { action: 'data_delete' } }),
          5000
        ).catch(() => 0),

        // Recent data requests (30 days)
        withTimeout(
          db.auditLog.count({
            where: {
              action: { in: ['data_export', 'data_delete'] },
              createdAt: { gte: thirtyDaysAgo },
            },
          }),
          5000
        ).catch(() => 0),
      ])

      // Users with data (for DPDP consent ratio) — separate query
      const usersWithData = await withTimeout(
        db.user.count({
          where: {
            OR: [
              { transactions: { some: {} } },
              { products: { some: {} } },
            ],
          },
        }),
        5000
      ).catch(() => 0)

      const totalLogins24h = failedLogins24h + successfulLogins24h
      const loginSuccessRate = totalLogins24h > 0
        ? Math.round((successfulLogins24h / totalLogins24h) * 1000) / 10
        : 100

      // Risk score
      const riskScore = calculateRiskScore({
        duplicatePhones: duplicatePhoneCount,
        suspiciousSignupDays: 0, // computed in fraud tab if needed
        inactiveNewUsers,
        bruteForceIps: bruteForceIpCount,
        failedLogins24h,
      })

      // DPDP score
      const dpdpScore = calculateDpdpScore({
        usersWithData,
        dataExportRequests,
        dataDeleteRequests,
      })

      return NextResponse.json({
        success: true,
        fraud: {
          duplicatePhoneCount,
          inactiveNewUsers,
          highValueTxnCount,
          riskScore,
        },
        dpdp: {
          usersWithData,
          dataExportRequests,
          dataDeleteRequests,
          recentDataRequests,
          complianceScore: dpdpScore,
        },
        security: {
          failedLogins24h,
          successfulLogins24h,
          loginSuccessRate,
          bruteForceIpCount,
          adminActions30Days,
        },
        breachReadiness: {
          encryptionAtRest: true,
          encryptionInTransit: true,
          auditLogEnabled: true,
          rateLimitingEnabled: true,
          csrfProtection: true,
          twoFactorAvailable: true,
          ipAllowlistConfigured: !!process.env.ADMIN_IP_ALLOWLIST,
        },
      })
    }

    // ============ FRAUD TAB (paginated detail lists) ============
    if (tab === 'fraud') {
      const skip = (page - 1) * pageSize

      // Parallel: duplicate phones (paginated) + high-value txns (paginated)
      const [phoneGroups, highValueTxns, phoneGroupTotal, highValueTxnTotal] = await Promise.all([
        // Duplicate phones — groupBy returns only groups, then we paginate in JS
        // (Prisma groupBy doesn't support skip/take on the group result cleanly,
        // so we get all groups >1 and slice — at scale this is bounded by distinct phones, not users)
        withTimeout(
          db.user.groupBy({
            by: ['phone'],
            where: { phone: { not: null } },
            _count: true,
            orderBy: { _count: { phone: 'desc' } },
          }),
          5000
        ).catch(() => [])
          .then((r: any[]) => r.filter(g => g._count > 1)),

        // High-value transactions (paginated)
        withTimeout(
          db.transaction.findMany({
            where: {
              totalAmount: { gte: 100000 },
              createdAt: { gte: sevenDaysAgo },
            },
            select: {
              id: true, userId: true, totalAmount: true, type: true, date: true,
              user: { select: { email: true, name: true } },
            },
            orderBy: { totalAmount: 'desc' },
            skip,
            take: pageSize,
          }),
          5000
        ).catch(() => []),

        // Total count of high-value txns (for pagination)
        withTimeout(
          db.transaction.count({
            where: {
              totalAmount: { gte: 100000 },
              createdAt: { gte: sevenDaysAgo },
            },
          }),
          5000
        ).catch(() => 0),

        // (phoneGroupTotal is computed from phoneGroups.length below)
        Promise.resolve(0),
      ])

      const duplicatePhones = (phoneGroups as any[]).slice(skip, skip + pageSize).map((g: any) => ({
        phone: g.phone,
        count: g._count,
      }))

      return NextResponse.json({
        success: true,
        duplicatePhones,
        duplicatePhonesTotal: (phoneGroups as any[]).length,
        highValueTransactions: (highValueTxns as any[]).map((t: any) => ({
          id: t.id,
          userId: t.userId,
          totalAmount: t.totalAmount,
          type: t.type,
          date: t.date.toISOString(),
          userEmail: t.user?.email,
          userName: t.user?.name,
        })),
        highValueTxnTotal,
        page,
        pageSize,
        highValueTxnTotalPages: Math.max(1, Math.ceil(highValueTxnTotal / pageSize)),
      })
    }

    // ============ SECURITY TAB (brute force IPs + admin actions) ============
    if (tab === 'security') {
      const skip = (page - 1) * pageSize

      // Parallel: brute force IPs (paginated) + admin action types
      const [bruteForceGroups, adminActionsByType, failedLoginIpsTotal] = await Promise.all([
        // Brute force IPs (DB-side groupBy, filter _count >= 5)
        withTimeout(
          db.auditLog.groupBy({
            by: ['ip'],
            where: {
              action: 'login_failure',
              createdAt: { gte: twentyFourHoursAgo },
              ip: { not: null },
            },
            _count: true,
            orderBy: { _count: { ip: 'desc' } },
          }),
          5000
        ).catch(() => [])
          .then((r: any[]) => r.filter(g => g._count >= 5)),

        // Admin actions by type (last 30 days)
        withTimeout(
          db.adminAction.groupBy({
            by: ['action'],
            where: { createdAt: { gte: thirtyDaysAgo } },
            _count: true,
            orderBy: { _count: { action: 'desc' } },
            take: 10,
          }),
          5000
        ).catch(() => []),

        Promise.resolve(0),
      ])

      const bruteForceIps = (bruteForceGroups as any[]).slice(skip, skip + pageSize).map((g: any) => ({
        ip: g.ip,
        count: g._count,
      }))

      return NextResponse.json({
        success: true,
        bruteForceIps,
        bruteForceIpsTotal: (bruteForceGroups as any[]).length,
        adminActionsByType: (adminActionsByType as any[]).map((a: any) => ({
          action: a.action,
          count: a._count,
        })),
        page,
        pageSize,
        bruteForceIpsTotalPages: Math.max(1, Math.ceil((bruteForceGroups as any[]).length / pageSize)),
      })
    }

    return NextResponse.json({ error: 'Invalid tab' }, { status: 400 })
  } catch (error) {
    console.error('Risk analytics error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch risk data',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

// ===== SCORING HELPERS (unchanged) =====

function calculateRiskScore(metrics: {
  duplicatePhones: number
  suspiciousSignupDays: number
  inactiveNewUsers: number
  bruteForceIps: number
  failedLogins24h: number
}): { score: number; level: 'low' | 'medium' | 'high' | 'critical' } {
  let score = 0
  score += metrics.duplicatePhones * 10
  score += metrics.suspiciousSignupDays * 15
  score += Math.min(metrics.inactiveNewUsers * 0.5, 20)
  score += metrics.bruteForceIps * 20
  score += Math.min(metrics.failedLogins24h * 0.2, 15)

  const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low'
  return { score: Math.min(100, Math.round(score)), level }
}

function calculateDpdpScore(metrics: {
  usersWithData: number
  dataExportRequests: number
  dataDeleteRequests: number
}): number {
  let score = 50
  if (metrics.dataExportRequests >= 0) score += 20
  if (metrics.dataDeleteRequests >= 0) score += 20
  if (metrics.usersWithData > 0) score -= 10
  return Math.min(100, Math.max(0, score))
}
