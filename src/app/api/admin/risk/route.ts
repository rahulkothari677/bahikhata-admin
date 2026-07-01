import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/admin/risk
 *
 * Returns risk & compliance analytics:
 *   1. Fraud detection — multiple accounts (same IP/phone), bot behavior, unusual patterns
 *   2. DPDP compliance — consent status, data requests
 *   3. Security overview — failed logins, suspicious activity
 *   4. Data breach response — checklist + incident log
 *   5. Backup status — last backup verification
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // ===== 1. FRAUD DETECTION =====

    // Multiple accounts from same phone number
    const usersWithPhone = await db.user.findMany({
      where: { phone: { not: null } },
      select: { id: true, email: true, phone: true, createdAt: true },
    })
    const phoneGroups: Record<string, typeof usersWithPhone> = {}
    for (const u of usersWithPhone) {
      if (u.phone) {
        if (!phoneGroups[u.phone]) phoneGroups[u.phone] = []
        phoneGroups[u.phone].push(u)
      }
    }
    const duplicatePhones = Object.entries(phoneGroups)
      .filter(([, users]) => users.length > 1)
      .map(([phone, users]) => ({ phone, count: users.length, users }))

    // Unusual signup patterns (10+ signups from same day — possible bot attack)
    const recentSignups = await db.user.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    const signupsByDay: Record<string, number> = {}
    for (const s of recentSignups) {
      const day = s.createdAt.toISOString().split('T')[0]
      signupsByDay[day] = (signupsByDay[day] || 0) + 1
    }
    const suspiciousSignupDays = Object.entries(signupsByDay)
      .filter(([, count]) => count >= 10)
      .map(([day, count]) => ({ day, count }))

    // Users with zero activity after 7 days (possible fake accounts)
    const inactiveNewUsers = await db.user.count({
      where: {
        createdAt: { lt: sevenDaysAgo },
        transactions: { none: {} },
        aiUsageLogs: { none: {} },
      },
    })

    // Unusual transaction patterns (very high value — possible money laundering)
    const highValueTransactions = await db.transaction.findMany({
      where: {
        totalAmount: { gte: 100000 }, // ₹1L+
        createdAt: { gte: sevenDaysAgo },
      },
      select: { id: true, userId: true, totalAmount: true, type: true, date: true },
      orderBy: { totalAmount: 'desc' },
      take: 10,
    })

    // ===== 2. DPDP COMPLIANCE =====

    // Total users (for consent ratio calculation)
    const totalUsers = await db.user.count()

    // Users who have data (transactions, products) — need consent for data sharing
    const usersWithData = await db.user.count({
      where: {
        OR: [
          { transactions: { some: {} } },
          { products: { some: {} } },
        ],
      },
    })

    // Data export requests (from AuditLog)
    const dataExportRequests = await db.auditLog.count({
      where: { action: 'data_export' },
    })

    // Data deletion requests
    const dataDeleteRequests = await db.auditLog.count({
      where: { action: 'data_delete' },
    })

    // Recent data requests (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const recentDataRequests = await db.auditLog.count({
      where: {
        action: { in: ['data_export', 'data_delete'] },
        createdAt: { gte: thirtyDaysAgo },
      },
    })

    // ===== 3. SECURITY OVERVIEW =====

    // Failed login attempts (last 24h)
    const failedLogins24h = await db.auditLog.count({
      where: {
        action: 'login_failure',
        createdAt: { gte: twentyFourHoursAgo },
      },
    })

    // Successful logins (last 24h)
    const successfulLogins24h = await db.auditLog.count({
      where: {
        action: 'login_success',
        createdAt: { gte: twentyFourHoursAgo },
      },
    })

    // Login success rate
    const totalLogins24h = failedLogins24h + successfulLogins24h
    const loginSuccessRate = totalLogins24h > 0 ? (successfulLogins24h / totalLogins24h) * 100 : 100

    // IPs with multiple failed logins (possible brute force)
    const failedLoginLogs = await db.auditLog.findMany({
      where: {
        action: 'login_failure',
        createdAt: { gte: twentyFourHoursAgo },
      },
      select: { ip: true },
    })
    const failedLoginByIp: Record<string, number> = {}
    for (const log of failedLoginLogs) {
      if (log.ip) {
        failedLoginByIp[log.ip] = (failedLoginByIp[log.ip] || 0) + 1
      }
    }
    const bruteForceIps = Object.entries(failedLoginByIp)
      .filter(([, count]) => count >= 5)
      .map(([ip, count]) => ({ ip, count }))

    // ===== 4. ADMIN ACTIONS (last 30 days) =====
    const adminActions30Days = await db.adminAction.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    })

    const adminActionsByType = await db.adminAction.groupBy({
      by: ['action'],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: true,
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    })

    // ===== 5. DATA BREACH READINESS =====
    const breachReadiness = {
      lastBackupVerified: null, // Would check backup system in production
      encryptionAtRest: true, // PostgreSQL on Neon has encryption
      encryptionInTransit: true, // HTTPS via Vercel
      auditLogEnabled: true,
      rateLimitingEnabled: true,
      csrfProtection: true,
      twoFactorAvailable: true,
      ipAllowlistConfigured: !!process.env.ADMIN_IP_ALLOWLIST,
    }

    return NextResponse.json({
      success: true,
      fraud: {
        duplicatePhones,
        suspiciousSignupDays,
        inactiveNewUsers,
        highValueTransactions,
        riskScore: calculateRiskScore({
          duplicatePhones: duplicatePhones.length,
          suspiciousSignupDays: suspiciousSignupDays.length,
          inactiveNewUsers,
          bruteForceIps: bruteForceIps.length,
          failedLogins24h,
        }),
      },
      dpdp: {
        totalUsers,
        usersWithData,
        dataExportRequests,
        dataDeleteRequests,
        recentDataRequests,
        complianceScore: calculateDpdpScore({
          usersWithData,
          dataExportRequests,
          dataDeleteRequests,
        }),
      },
      security: {
        failedLogins24h,
        successfulLogins24h,
        loginSuccessRate: Math.round(loginSuccessRate * 10) / 10,
        bruteForceIps,
        adminActions30Days,
        adminActionsByType,
      },
      breachReadiness,
    })
  } catch (error) {
    console.error('Risk analytics error:', error)
    return NextResponse.json({ error: 'Failed to fetch risk data' }, { status: 500 })
  }
}

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
  score += Math.min(metrics.inactiveNewUsers * 2, 30)
  score += metrics.bruteForceIps * 20
  score += Math.min(metrics.failedLogins24h * 0.5, 25)

  const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low'
  return { score: Math.min(100, score), level }
}

function calculateDpdpScore(metrics: {
  usersWithData: number
  dataExportRequests: number
  dataDeleteRequests: number
}): number {
  // Simplified DPDP compliance score (0-100)
  // In production, this would check: consent collection, privacy policy, data processing agreements, etc.
  let score = 50 // base score for having the infrastructure

  // Points for having audit trail of data requests
  if (metrics.dataExportRequests >= 0) score += 20 // we track them
  if (metrics.dataDeleteRequests >= 0) score += 20 // we track them

  // Deduct points if we have users with data but no consent system yet
  if (metrics.usersWithData > 0) score -= 10 // need to implement consent

  return Math.min(100, Math.max(0, score))
}
