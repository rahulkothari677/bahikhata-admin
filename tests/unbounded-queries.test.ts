import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
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

describe('the sweep is complete — no uncapped findMany remains', () => {
  // 2026-07-29: this is the backstop for the whole class. Adding a findMany
  // without a `take` anywhere under src/app/api now fails here, rather than
  // being found later by a dashboard timing out in production.
  //
  // Exemptions are deliberate and narrow: a query bounded by `in: [...]` is
  // bounded by whatever built that list, and the pager helpers pass `take`
  // through as a shorthand variable.
  it('every findMany is bounded, by a take or by an id list', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const e of readdirSync(dir)) {
        const full = join(dir, e)
        if (statSync(full).isDirectory()) out.push(...walk(full))
        else if (e.endsWith('.ts')) out.push(full)
      }
      return out
    }

    const offenders: string[] = []
    for (const file of walk(join(__dirname, '..', 'src', 'app', 'api'))) {
      const src = codeOnly(readFileSync(file, 'utf8'))
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        if (!/\bdb(?:Read)?\.[a-zA-Z]+\.findMany\(/.test(line)) return
        const head = lines.slice(i, i + 16).join('\n')
        if (/\btake\b/.test(head)) return
        const where = /where:\s*\{([\s\S]{0,140}?)\}/.exec(head)
        if (where && /\bin:\s/.test(where[1])) return
        offenders.push(`${file.split(/api[\/]/)[1]}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('cohort retention is computed in one query', () => {
  const src = codeOnly(read('revenue/route.ts'))

  it('no longer loads every user from the last 8 weeks', () => {
    // Was: findMany(all users in 8 weeks), then up to 40 follow-up counts, each
    // carrying the cohort's whole id list in an IN clause.
    expect(src).not.toMatch(/user\.findMany\(\s*\{\s*where:\s*\{\s*createdAt:\s*\{\s*gte:\s*eightWeeksAgo/)
    expect(src).toMatch(/WITH cohort AS/)
  })

  it('preserves SUNDAY-start weeks, so old cohorts stay comparable', () => {
    // Postgres date_trunc('week') starts on Monday. Shifting a day either side
    // reproduces the previous getWeekStart() behaviour exactly — changing it
    // silently would move every historical cohort and make this quarter
    // incomparable with last.
    expect(src).toMatch(/date_trunc\('week', "createdAt" \+ INTERVAL '1 day'\) - INTERVAL '1 day'/)
  })

  it('still distinguishes "not yet measurable" from "nobody returned"', () => {
    // Collapsing -1 into 0 would render every brand-new cohort as 0% retained.
    expect(src).toMatch(/retention\.push\(-1\)/)
  })

  it('removed the JS week helper rather than leaving two definitions', () => {
    expect(src).not.toMatch(/function getWeekStart/)
  })
})

describe('churned MRR counts THIS month, not all of history', () => {
  const src = read('revenue/route.ts')

  it('filters on the owner’s cancellation date', () => {
    // The old query was `where: { status: 'cancelled' }` with a comment saying
    // it should check cancelledAt — a filter described but never written. It
    // summed every cancellation ever and reported it as this month's churn, so
    // netMrrMovement drifted further negative every month regardless of
    // performance. Subscription has no cancelledAt; the date lives on User.
    expect(src).toMatch(/JOIN "User" u ON u\."id" = s\."userId"/)
    expect(src).toMatch(/u\."cancelledAt" >= /)
  })

  it('converts paise on every raw money query in this route', () => {
    const rawSums = src.match(/_paise/g) ?? []
    expect(rawSums.length).toBeGreaterThanOrEqual(3)
    // Double-escaped: inside a TEMPLATE LITERAL `\s` collapses to a plain `s`,
    // so the pattern would silently look for the letters s and S instead of
    // whitespace — a regex that compiles, runs, and matches nothing.
    for (const alias of ['monthly_paise', 'new_paise', 'expansion_paise', 'churned_paise']) {
      expect(src, alias).toMatch(new RegExp(`${alias}[\\s\\S]{0,200}\\/\\s*100`))
    }
  })
})

describe('campaign steps cannot half-send', () => {
  const src = read('campaigns/[id]/action/route.ts')

  it('refuses an oversized step instead of slicing it', () => {
    expect(codeOnly(src)).not.toMatch(/userIds\.slice\(0,\s*1000\)/)
    expect(src).toMatch(/MAX_STEP_RECIPIENTS/)
    expect(src).toMatch(/TOO_MANY_RECIPIENTS/)
  })

  it('says nothing was sent, and audits the refusal', () => {
    // Re-running a half-sent step double-messages everyone who already got it.
    expect(src).toMatch(/Nothing was sent/)
    expect(src).toMatch(/campaign_step_refused/)
  })
})

describe('offset pagination is depth-guarded everywhere', () => {
  it('the support queue has the guard the other twenty routes have', () => {
    const src = read('support/route.ts')
    expect(src).toMatch(/assertPageDepth/)
    // And it must not swallow the refusal into a generic 500 — that message
    // sends an operator hunting an outage that is not happening.
    expect(src).toMatch(/instanceof PageTooDeepError\) throw error/)
  })
})
