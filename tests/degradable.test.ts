import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Degradable } from '../src/lib/degradable'

/**
 * Guards for honest degradation.
 *
 * WHY (audit 2026-07-27): 292 places in this codebase turn a failed query into
 * a plausible value:
 *
 *     await db.fraudAlert.count().catch(() => 0)
 *
 * The intent is right — one broken widget should not blank the dashboard. But
 * the result is that a FAILURE becomes indistinguishable from a FACT:
 *
 *   "0 fraud alerts"  might be zero, or might be a timeout
 *   "no API keys"     was actually a broken query — this really happened, the
 *                     page rendered empty for weeks
 *   "Rs.0 revenue"    might be no sales, or a dead connection
 *
 * A founder reading the dashboard cannot tell. Neither can an investor reading
 * a report built from it. Silence is the worst failure mode: the system looks
 * healthy while lying.
 *
 * Degradable keeps the fallback (so the page renders) but records WHICH values
 * are fallbacks, so the UI can show "—" instead of a confident zero.
 */

describe('Degradable', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('returns the real value and reports nothing degraded on success', async () => {
    const d = new Degradable('req-1')
    const v = await d.settle('userCount', async () => 42, 0)
    expect(v).toBe(42)
    expect(d.report()).toEqual({ degraded: [], isDegraded: false })
  })

  it('returns the fallback AND names the failure', async () => {
    // The whole point: the dashboard still renders, but the response says
    // this number is not real.
    const d = new Degradable('req-2')
    const v = await d.settle('fraudCount', async () => { throw new Error('timeout') }, 0)
    expect(v).toBe(0)
    expect(d.report()).toEqual({ degraded: ['fraudCount'], isDegraded: true })
  })

  it('distinguishes a genuine zero from a failed zero', async () => {
    // Both return 0. Only one is a fact. This is the entire bug class.
    const d = new Degradable()
    const real = await d.settle('a', async () => 0, 0)
    const failed = await d.settle('b', async () => { throw new Error('x') }, 0)
    expect(real).toBe(0)
    expect(failed).toBe(0)
    expect(d.report().degraded).toEqual(['b'])
    expect(d.report().degraded).not.toContain('a')
  })

  it('collects multiple failures independently', async () => {
    const d = new Degradable()
    await d.settle('a', async () => { throw new Error('1') }, 0)
    await d.settle('b', async () => 5, 0)
    await d.settle('c', async () => { throw new Error('2') }, 0)
    expect(d.report().degraded).toEqual(['a', 'c'])
  })

  it('never leaks the underlying error to the caller', async () => {
    // Exception text carries table names, column names and query fragments.
    // It goes to the server log, never into a response.
    const d = new Degradable()
    const v = await d.settle(
      'x',
      async () => { throw new Error('relation "SecretTable" does not exist') },
      'fallback',
    )
    expect(v).toBe('fallback')
    expect(JSON.stringify(d.report())).not.toContain('SecretTable')
  })

  it('logs the real error server-side so it is still diagnosable', async () => {
    const spy = vi.spyOn(console, 'error')
    const d = new Degradable('req-abc')
    await d.settle('widget', async () => { throw new Error('boom') }, null)
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0][0])).toContain('widget')
    expect(String(spy.mock.calls[0][0])).toContain('req-abc')
  })

  it('markFailed records synchronously, so report() cannot race it', async () => {
    // Routing an already-caught error back through settle() returns a promise;
    // forgetting to await it means report() is built before the failure lands.
    // markFailed exists precisely to remove that footgun.
    const d = new Degradable()
    d.markFailed('activityFeed', new Error('nope'))
    expect(d.report().degraded).toEqual(['activityFeed'])
  })

  describe('strict()', () => {
    it('returns the value on success', async () => {
      const d = new Degradable()
      expect(await d.strict('money', async () => 100)).toBe(100)
    })

    it('RETHROWS on failure — money must never be faked', async () => {
      // A P&L that silently reports Rs.0 for a failed query is worse than an
      // error page. Anything a decision or a legal obligation rests on uses
      // strict() and fails loudly.
      const d = new Degradable()
      await expect(
        d.strict('revenue', async () => { throw new Error('db down') }),
      ).rejects.toThrow('db down')
    })
  })
})
