'use client'

import { AlertTriangle } from 'lucide-react'

/**
 * Shows which figures on a screen are NOT real.
 *
 * WHY (audit 2026-07-27): the admin API used to turn a failed query into a
 * plausible value — `.catch(() => 0)`. "0 fraud alerts" was indistinguishable
 * from "the fraud query timed out". A founder reading the dashboard could not
 * tell, and neither could an investor reading a report built from it.
 *
 * The API now returns `degraded: string[]` naming the sections whose value is
 * a fallback. That was only half the fix — a flag nothing renders is a flag
 * nobody sees. This is the other half.
 *
 * Deliberately loud. The whole point is that a silently wrong number is worse
 * than an obviously missing one.
 */
export function DegradedBanner({
  degraded,
  className = '',
}: {
  degraded?: string[] | null
  className?: string
}) {
  if (!degraded || degraded.length === 0) return null

  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200 ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-sm">
        <p className="font-medium">
          {degraded.length === 1 ? 'One figure on this page could not be loaded' : `${degraded.length} figures on this page could not be loaded`}
        </p>
        <p className="mt-1 text-amber-800/90 dark:text-amber-300/90">
          These are showing a placeholder, not a real value. Do not treat them
          as zero: <span className="font-mono text-xs">{degraded.join(', ')}</span>
        </p>
      </div>
    </div>
  )
}

/**
 * Renders warnings that qualify a report rather than invalidate it — e.g. the
 * P&L reporting deferred revenue, or revenue that has never been computed.
 * Distinct from DegradedBanner: nothing failed, but the number needs context.
 */
export function ReportWarnings({
  warnings,
  className = '',
}: {
  warnings?: string[] | null
  className?: string
}) {
  if (!warnings || warnings.length === 0) return null

  return (
    <div
      role="status"
      className={`space-y-2 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200 ${className}`}
    >
      {warnings.map((w, i) => (
        <p key={i} className="text-sm leading-relaxed">
          {w}
        </p>
      ))}
    </div>
  )
}
