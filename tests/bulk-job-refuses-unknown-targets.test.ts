import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * A bulk job whose target list could not be read must not report success.
 *
 * WHY (audit 2026-08-04, Phase 7). Each target-resolution query degraded to []
 * on error. An empty list then sailed past the over-limit guard, the per-user
 * loop ran zero times, and the job was marked completed with 0 processed —
 * indistinguishable from "the segment genuinely matched nobody".
 *
 * So a founder scheduling a discount for 500 churning users would see the job
 * marked completed, and not one of them would receive it. The only trace was a
 * `[degraded/cron]` line in a log nobody reads.
 *
 * ctx.degrade exists precisely to mark a value as NOT REAL — the wrapper even
 * injects a `degraded: [...]` array into API responses for exactly this reason.
 * But the degraded value still flowed into a job outcome without anyone
 * consulting it. Same shape as the daily-stats rollup writing a wrong number
 * into stored history: a failure that gets recorded as a fact.
 *
 * These are source assertions. The executor needs a live database, a scheduled
 * job row and a cron secret to run, so the behaviour is pinned where it is
 * decided rather than not pinned at all.
 */

const ROUTE = path.resolve(__dirname, '../src/app/api/admin/bulk-jobs/execute/route.ts')
const src = fs.readFileSync(ROUTE, 'utf8').replace(/\r\n/g, '\n')

describe('a failed target lookup is distinguishable from an empty one', () => {
  it('tracks that resolution degraded', () => {
    expect(src).toMatch(/let targetsDegraded = false/)
  })

  it('routes EVERY target query through the flag, not ctx.degrade directly', () => {
    /*
     * One missed call site reopens the hole silently — that is how it got here.
     *
     * Scoped to the queries that resolve WHO the job acts on: user.findMany and
     * userSegmentCache.findMany. Deliberately NOT bulkJob.findMany, which reads
     * the job list itself — if that degrades, no jobs are picked up and they
     * stay 'scheduled' for the next run, which is already safe.
     */
    const direct = src.match(/\.catch\(ctx\.degrade\('(?:user|userSegmentCache)\.findMany',\s*\[\]\)\)/g) || []
    expect(direct).toEqual([])
    expect((src.match(/\.catch\(markDegraded\(/g) || []).length).toBeGreaterThanOrEqual(4)
  })

  it('marks the job failed rather than completed', () => {
    const block = src.slice(src.indexOf('if (targetsDegraded)'))
    expect(block.slice(0, 700)).toMatch(/status: 'failed'/)
  })

  it('records WHY, so the job can be re-run deliberately', () => {
    const block = src.slice(src.indexOf('if (targetsDegraded)'), src.indexOf('if (targetsDegraded)') + 700)
    expect(block).toMatch(/errorMessage/)
    expect(block).toMatch(/Nothing was done/)
  })

  it('checks degradation BEFORE the over-limit guard', () => {
    // An unknown target set is worse than an oversized one: the size guard
    // would let an empty degraded list through as "small enough to run".
    const degradedAt = src.indexOf('if (targetsDegraded)')
    const limitAt = src.indexOf('if (users.length > SYNC_EXECUTION_LIMIT)')
    expect(degradedAt).toBeGreaterThan(-1)
    expect(limitAt).toBeGreaterThan(-1)
    expect(degradedAt).toBeLessThan(limitAt)
  })

  it('does not leave the job scheduled, which would retry against a broken query forever', () => {
    const block = src.slice(src.indexOf('if (targetsDegraded)'), src.indexOf('if (targetsDegraded)') + 700)
    expect(block).not.toMatch(/status: 'scheduled'/)
  })
})

describe('the existing over-limit refusal is intact', () => {
  // Control: an earlier audit fixed a silent `users.slice(0, 1000)`. This fix
  // must not have disturbed it.
  it('still refuses an oversized job outright', () => {
    const block = src.slice(src.indexOf('if (users.length > SYNC_EXECUTION_LIMIT)'))
    expect(block.slice(0, 800)).toMatch(/status: 'failed'/)
    expect(block.slice(0, 800)).toMatch(/Nothing was done/)
  })
})
