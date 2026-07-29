import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * WHY (audit 2026-07-28): 31 findMany calls in the admin API had no row cap.
 * Triaged rather than blanket-capped — most are bounded by an `in: [...]` list
 * that is itself capped upstream, and several "hits" were my own detector
 * matching findMany inside a COMMENT (the same comment-grep false positive that
 * has fired on this codebase four times now).
 *
 * These are the ones that were genuinely unbounded, where the row count grows
 * with the size of the business rather than with the request.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', 'app', 'api', 'admin', p), 'utf8')

/** Strips comments, so a comment quoting the OLD buggy code cannot pass a guard. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('aggregations happen in Postgres, not in the function', () => {
  it('LTV no longer loads every active subscription', () => {
    // Was: findMany(all active subs) then .reduce() in JS. At 100K paying users
    // that is 100K rows crossing the wire to produce two numbers.
    const src = codeOnly(read('revenue/route.ts'))
    expect(src).not.toMatch(/subscription\.findMany\(\s*\{\s*where:\s*\{\s*status:\s*'active'/)
    expect(src).toMatch(/SUM\(/)
    expect(src).toMatch(/FROM "Subscription"/)
  })

  it('LTV converts paise to rupees, because $queryRaw bypasses the money extension', () => {
    // The single most dangerous detail in this change. The extension converts
    // findMany/aggregate results; a raw query is neither, so `amount` arrives
    // in PAISE. Without the /100 the dashboard would report LTV 100x too high —
    // the exact class of bug this audit opened with.
    const src = read('revenue/route.ts')
    expect(src).toMatch(/monthly_paise/)
    expect(src).toMatch(/monthly_paise[\s\S]{0,120}\/\s*100/)
  })

  it('signups-per-day groups in SQL rather than loading every new user', () => {
    const src = codeOnly(read('growth/route.ts'))
    expect(src).not.toMatch(/user\.findMany\(\s*\{\s*where:\s*\{\s*createdAt:\s*\{\s*gte:\s*thirtyDaysAgo/)
    expect(src).toMatch(/date_trunc\('day', "createdAt"\)/)
    expect(src).toMatch(/GROUP BY day/)
  })

  it('still seeds every one of the 30 days, so an empty day is a zero not a gap', () => {
    // A chart that silently omits days with no signups reads as "no data yet"
    // rather than "nobody signed up on Tuesday".
    const src = read('growth/route.ts')
    expect(src).toMatch(/for \(let i = 29; i >= 0; i--\)/)
    // `.+` not `[^\]]+` — the key expression contains its own brackets
    // (`split('T')[0]`), which a negated-class match cannot cross.
    expect(src).toMatch(/signupsByDay\[.+\] = 0/)
  })
})

describe('bulk jobs cannot silently act on a subset', () => {
  const src = read('bulk-jobs/execute/route.ts')

  it('caps how many users a targeting query may load', () => {
    // "every user on the free plan" is unbounded — at a million users the job
    // is OOM-killed having already marked itself running.
    expect(src).toMatch(/MAX_BULK_TARGETS\s*=\s*10_000/)
    const code = codeOnly(src)
    expect(code).toMatch(/where:\s*\{\s*plan:\s*criteria\.plan\s*\}[\s\S]{0,200}take:\s*MAX_BULK_TARGETS/)
    expect(code).toMatch(/segmentId:\s*criteria\.segmentId[\s\S]{0,200}take:\s*MAX_BULK_TARGETS/)
  })

  it('REFUSES an oversized job instead of truncating it', () => {
    // THE bug: `users.slice(0, 1000)` processed 1,000 of 5,000, marked the job
    // completed, and reported a success count that looked like the whole job.
    // For change_plan or ban, "we did this to an unknown subset" is the worst
    // possible outcome.
    const code = codeOnly(src)
    expect(code).not.toMatch(/users\.slice\(0,\s*1000\)/)
    expect(code).toMatch(/users\.length > SYNC_EXECUTION_LIMIT/)
    expect(code).toMatch(/status:\s*'failed'/)
  })

  it('tells the operator nothing was done, and what to do instead', () => {
    // A refusal that does not say the job was a no-op invites a retry that
    // double-applies the part that did run.
    expect(src).toMatch(/Nothing was done/)
    expect(src).toMatch(/Narrow the segment|split this into smaller jobs/)
  })

  it('reports refused jobs separately from failed ones', () => {
    // A refused job did NOTHING; a failed one may have acted on some users
    // before dying. Collapsing them loses the distinction that matters.
    expect(src).toMatch(/refusedJobs/)
    expect(src).toMatch(/REFUSED as too large/)
  })

  it('audits the refusal', () => {
    expect(src).toMatch(/bulk_job_refused/)
  })
})
