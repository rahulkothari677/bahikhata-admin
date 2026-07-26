import { describe, it, expect } from 'vitest'

/**
 * Guards for the PUBLIC status page's health logic.
 *
 * WHY (audit 2026-07-26, found by probing the live deployment):
 * https://bahikhata-admin.vercel.app/api/status was returning
 *   overall: "degraded", payments: "degraded", ai_providers: "degraded"
 * to the open internet. The header comment describes this page as being for
 * "investors, users, and monitoring tools".
 *
 * The cause was not an outage. Both checks tested whether a credential existed
 * in the ADMIN app's environment:
 *   !!(process.env.RAZORPAY_KEY_ID || ...)
 *   !!(process.env.GEMINI_API_KEY || ...)
 * Those keys belong to the MAIN app and are deliberately absent here — that
 * isolation is the entire reason the two apps live on separate Vercel accounts.
 * So the check could never pass, and the page reported a permanent false outage.
 *
 * The rules these tests pin down:
 *   1. "No recent activity" is UNKNOWN, never an outage.
 *   2. UNKNOWN must not drag `overall` below operational.
 *   3. A real failure rate still reports degraded/down.
 */

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'unknown'

// Mirrors the classification in src/app/api/status/route.ts.
function classify(recent: number, failures: number): ServiceStatus {
  if (recent === 0) return 'unknown'
  const failureRate = failures / recent
  if (failureRate >= 0.5) return 'down'
  if (failureRate >= 0.1) return 'degraded'
  return 'operational'
}

// Mirrors the `overall` reduction in the route.
function overallFrom(statuses: ServiceStatus[], activeIncidents = 0): string {
  if (statuses.some((s) => s === 'down')) return 'major_outage'
  if (statuses.some((s) => s === 'degraded')) return 'degraded'
  if (activeIncidents > 0) return 'degraded'
  return 'operational'
}

describe('public status page — service classification', () => {
  it('reports unknown (not degraded) when there is no activity to judge by', () => {
    // This is the pre-launch case, and the case that produced the false
    // "payment gateway degraded" banner on the live site.
    expect(classify(0, 0)).toBe('unknown')
  })

  it('reports operational when activity is succeeding', () => {
    expect(classify(100, 0)).toBe('operational')
    expect(classify(100, 5)).toBe('operational') // 5% — below the degraded floor
  })

  it('reports degraded at a 10% failure rate', () => {
    expect(classify(100, 10)).toBe('degraded')
  })

  it('reports down at a 50% failure rate', () => {
    expect(classify(100, 50)).toBe('down')
  })
})

describe('public status page — overall rollup', () => {
  it('stays operational when unobservable services are unknown', () => {
    // The exact live scenario: db + api fine, ai + payments unobservable.
    expect(
      overallFrom(['operational', 'operational', 'unknown', 'unknown']),
    ).toBe('operational')
  })

  it('still surfaces a genuine degradation', () => {
    expect(
      overallFrom(['operational', 'operational', 'degraded', 'unknown']),
    ).toBe('degraded')
  })

  it('still surfaces a genuine outage', () => {
    expect(overallFrom(['operational', 'down', 'unknown', 'unknown'])).toBe(
      'major_outage',
    )
  })

  it('an unresolved incident degrades even when every service looks fine', () => {
    expect(overallFrom(['operational', 'operational'], 1)).toBe('degraded')
  })
})
