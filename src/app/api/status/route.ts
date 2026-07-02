import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withTimeout, checkDbHealth } from '@/lib/resilience'

/**
 * GET /api/status
 *
 * PUBLIC endpoint (NO AUTH REQUIRED) — returns system status for the
 * public /status page. Used by investors, users, and monitoring tools.
 *
 * Returns:
 *   - overall: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance'
 *   - services: { api, database, ai_providers, payments } each with status + responseTime
 *   - activeIncidents: unresolved incidents with latest update
 *   - recentIncidents: last 10 resolved incidents (for history)
 *   - lastUpdated: timestamp
 *
 * Cached for 60 seconds (Cache-Control header) to handle traffic spikes.
 */

// Disable auth middleware for this route (already handled in middleware.ts PUBLIC_PATHS)
export const dynamic = 'force-dynamic'

export async function GET() {
  const startTime = Date.now()

  try {
    // ============ SERVICE HEALTH CHECKS ============
    // Run all checks in parallel for speed

    const [dbHealthy, dbResponseTime] = await checkServiceHealth(async () => {
      const t0 = Date.now()
      const healthy = await checkDbHealth()
      return { healthy, responseTime: Date.now() - t0 }
    })

    // API is always "operational" if this endpoint responds (it IS the API)
    const apiHealthy = true
    const apiResponseTime = Date.now() - startTime

    // AI providers — check if any provider env var is set (lightweight check, no actual API call)
    const aiProvidersConfigured = !!(
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GROQ_API_KEY
    )
    // For public status, we say "operational" if configured, "degraded" if not
    const aiHealthy = aiProvidersConfigured
    const aiResponseTime = 0 // no actual call made

    // Payments — check if Razorpay key is set
    const paymentsConfigured = !!(process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_SECRET)
    const paymentsHealthy = paymentsConfigured
    const paymentsResponseTime = 0

    const services = {
      api: {
        status: apiHealthy ? 'operational' : 'down',
        responseTimeMs: apiResponseTime,
        label: 'API & Web App',
      },
      database: {
        status: dbHealthy ? 'operational' : 'down',
        responseTimeMs: dbResponseTime,
        label: 'Database',
      },
      ai_providers: {
        status: aiHealthy ? 'operational' : 'degraded',
        responseTimeMs: aiResponseTime,
        label: 'AI Providers (Gemini/OpenAI/Groq)',
      },
      payments: {
        status: paymentsHealthy ? 'operational' : 'degraded',
        responseTimeMs: paymentsResponseTime,
        label: 'Payment Gateway (Razorpay)',
      },
    }

    // ============ ACTIVE INCIDENTS ============
    // Fetch unresolved incidents + their latest update
    const activeIncidentsRaw = await withTimeout(
      db.incident.findMany({
        where: { status: { not: 'resolved' } },
        orderBy: { startedAt: 'desc' },
        include: {
          updates: {
            orderBy: { createdAt: 'desc' },
            take: 1, // only latest update
          },
        },
      }),
      5000
    ).catch(() => [])

    const activeIncidents = (activeIncidentsRaw as any[]).map((i: any) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      severity: i.severity,
      status: i.status,
      service: i.service,
      startedAt: i.startedAt.toISOString(),
      latestUpdate: i.updates[0] ? {
        message: i.updates[0].message,
        status: i.updates[0].status,
        createdAt: i.updates[0].createdAt.toISOString(),
      } : null,
    }))

    // ============ RECENT RESOLVED INCIDENTS (history) ============
    const recentIncidentsRaw = await withTimeout(
      db.incident.findMany({
        where: { status: 'resolved' },
        orderBy: { resolvedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          severity: true,
          service: true,
          startedAt: true,
          resolvedAt: true,
        },
      }),
      5000
    ).catch(() => [])

    const recentIncidents = (recentIncidentsRaw as any[]).map((i: any) => ({
      ...i,
      startedAt: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() || null,
    }))

    // ============ COMPUTE OVERALL STATUS ============
    let overall: string = 'operational'

    // Check for maintenance
    const hasMaintenance = activeIncidents.some(i => i.severity === 'maintenance')
    if (hasMaintenance) {
      overall = 'maintenance'
    }
    // Check for critical unresolved incidents
    else if (activeIncidents.some(i => i.severity === 'critical')) {
      overall = 'major_outage'
    }
    // Check for major unresolved incidents
    else if (activeIncidents.some(i => i.severity === 'major')) {
      overall = 'partial_outage'
    }
    // Check for any service down
    else if (Object.values(services).some(s => s.status === 'down')) {
      overall = 'major_outage'
    }
    // Check for degraded services
    else if (Object.values(services).some(s => s.status === 'degraded')) {
      overall = 'degraded'
    }
    // Check for minor incidents
    else if (activeIncidents.length > 0) {
      overall = 'degraded'
    }

    const response = {
      success: true,
      overall,
      services,
      activeIncidents,
      recentIncidents,
      lastUpdated: new Date().toISOString(),
    }

    // Cache for 60 seconds (reduces DB load during traffic spikes)
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    })
  } catch (error) {
    // Even if everything fails, return a safe response (don't crash the status page)
    return NextResponse.json({
      success: false,
      overall: 'degraded',
      services: {
        api: { status: 'operational', responseTimeMs: Date.now() - startTime, label: 'API & Web App' },
        database: { status: 'down', responseTimeMs: 0, label: 'Database' },
        ai_providers: { status: 'unknown', responseTimeMs: 0, label: 'AI Providers' },
        payments: { status: 'unknown', responseTimeMs: 0, label: 'Payment Gateway' },
      },
      activeIncidents: [],
      recentIncidents: [],
      lastUpdated: new Date().toISOString(),
      error: 'Status check failed',
    }, { status: 200 }) // 200 even on error — status page must always render
  }
}

// Helper: run a health check with timeout
async function checkServiceHealth<T>(
  fn: () => Promise<{ healthy: boolean; responseTime: number; data?: T }>
): Promise<[boolean, number]> {
  try {
    const result = await withTimeout(fn(), 5000)
    return [result.healthy, result.responseTime]
  } catch {
    return [false, 0]
  }
}
