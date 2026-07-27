/**
 * HONEST DEGRADATION — telling the caller which numbers are real.
 *
 * THE PROBLEM (audit 2026-07-27): 292 places in this codebase do
 *
 *     await db.something.count(...).catch(() => 0)
 *     await db.something.findMany(...).catch(() => [])
 *
 * The intent is good — one failing widget should not blank the whole
 * dashboard. The execution is not: a failure becomes a VALUE, and the value is
 * indistinguishable from the truth.
 *
 *   "0 fraud alerts"        might mean zero, or might mean the query failed
 *   "no API keys"           was actually a broken query (this really happened)
 *   "Rs.0 revenue"          might mean no sales, or a timeout
 *   an export missing rows  looked exactly like a user with no transactions
 *
 * A founder reading a dashboard cannot tell these apart, and neither can an
 * investor reading a report generated from it. Silence is the worst failure
 * mode: the system looks healthy while lying.
 *
 * THE RULE: a fallback value is fine — the dashboard should still render — but
 * the response MUST say which parts are unreliable, so the UI can show "—"
 * instead of a confident zero.
 *
 *     const d = new Degradable(ctx.requestId)
 *     const users  = await d.settle('userCount',  () => db.user.count(), 0)
 *     const alerts = await d.settle('fraudCount', () => db.fraudAlert.count(), 0)
 *     return NextResponse.json({ users, alerts, ...d.report() })
 *
 * The response then carries:
 *     degraded: ['fraudCount']   // this number is NOT trustworthy
 */

export interface DegradationReport {
  /** Section names whose value is a fallback, not real data. Empty = all good. */
  degraded: string[]
  /** True if anything failed. Lets a UI show one banner without inspecting the list. */
  isDegraded: boolean
}

export class Degradable {
  private readonly failures: string[] = []

  constructor(private readonly requestId?: string) {}

  /**
   * Runs `fn`. On success returns its value. On failure returns `fallback`,
   * records the section as degraded, and logs the real error server-side.
   *
   * The error is never returned to the client — it may contain table names,
   * constraint names and query fragments.
   */
  async settle<T>(section: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      this.failures.push(section)
      console.error(
        `[degraded] ${section}${this.requestId ? ` (${this.requestId})` : ''}:`,
        err,
      )
      return fallback
    }
  }

  /**
   * Records a section as degraded when the failure was caught elsewhere (an
   * existing try/catch around a block, rather than a single awaited call).
   *
   * Synchronous on purpose: routing a already-caught error back through
   * settle() would return a promise, and forgetting to await it means
   * report() can be built before the failure is registered.
   */
  markFailed(section: string, err: unknown): void {
    this.failures.push(section)
    console.error(
      `[degraded] ${section}${this.requestId ? ` (${this.requestId})` : ''}:`,
      err,
    )
  }

  /**
   * For values that must NOT be faked. Money reconciliation, compliance
   * exports, anything a decision or a legal obligation rests on. Rethrows so
   * the route fails loudly rather than reporting a plausible wrong number.
   */
  async strict<T>(section: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      console.error(
        `[strict-failed] ${section}${this.requestId ? ` (${this.requestId})` : ''}:`,
        err,
      )
      throw err
    }
  }

  /** Spread into the JSON response. */
  report(): DegradationReport {
    return {
      degraded: [...this.failures],
      isDegraded: this.failures.length > 0,
    }
  }

  get isDegraded(): boolean {
    return this.failures.length > 0
  }
}

/**
 * Marks a number whose source failed, for direct use in a payload.
 * `null` is deliberate: JSON has no NaN, and any sentinel number (0, -1) is
 * exactly the confusion this module exists to prevent.
 */
export function unknownNumber(): null {
  return null
}
