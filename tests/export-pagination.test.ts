import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  fetchAllPaged,
  fetchWithTruncationFlag,
  ExportIncompleteError,
  DSAR_HARD_CEILING,
} from '../src/lib/export-pagination'

/**
 * Guards for export completeness.
 *
 * WHY (audit 2026-07-26): /api/admin/data-exports/generate produced legally
 * defective subject-access exports in three compounding ways:
 *
 *   findMany({ where: { userId }, take: 1000 }).catch(() => [])
 *
 *   - take: 1000 silently truncated. A shopkeeper with 4,000 transactions
 *     received 1,000 and nothing said so. DPDP s.11 gives the Data Principal a
 *     right to a summary of ALL personal data being processed.
 *   - .catch(() => []) turned a failed query into an empty section, which is
 *     indistinguishable from "this user has no transactions".
 *   - bulk exports then set `truncated: false` literally in the payload while
 *     applying take: 10000 — asserting completeness while truncating.
 *
 * The rule: an export is either COMPLETE, or it says loudly that it is not.
 * It must never quietly be neither.
 */

/** Builds a fake table of N rows and a keyset-paging fetcher over it. */
function fakeTable(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    id: String(i + 1).padStart(8, '0'),
  }))
  let calls = 0
  const fetchBatch = async (cursor: string | undefined, take: number) => {
    calls++
    const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0
    return rows.slice(start, start + take)
  }
  return { rows, fetchBatch, callCount: () => calls }
}

describe('fetchAllPaged — subject access completeness', () => {
  it('returns EVERY row, not the first page', () => {
    // The exact defect: 4,000 rows with a 1,000 cap returned 1,000.
    const t = fakeTable(4000)
    return fetchAllPaged('transactions', t.fetchBatch, 1000).then((all) => {
      expect(all).toHaveLength(4000)
      expect(all[0].id).toBe('00000001')
      expect(all[3999].id).toBe('00004000')
    })
  })

  it('returns no duplicates and no gaps across page boundaries', async () => {
    // Off-by-one in cursor handling is the classic keyset bug: either the
    // boundary row repeats or it vanishes. Both corrupt a legal document.
    const t = fakeTable(2500)
    const all = await fetchAllPaged('transactions', t.fetchBatch, 500)
    const ids = all.map((r) => r.id)
    expect(new Set(ids).size).toBe(2500)
    expect(ids).toEqual([...ids].sort())
  })

  it('handles an exact multiple of the batch size', async () => {
    // 2000 rows at batch 1000: the second page is full, so a naive loop
    // terminates only after a third, empty request.
    const t = fakeTable(2000)
    const all = await fetchAllPaged('x', t.fetchBatch, 1000)
    expect(all).toHaveLength(2000)
  })

  it('handles empty and single-row tables', async () => {
    expect(await fetchAllPaged('x', fakeTable(0).fetchBatch, 1000)).toHaveLength(0)
    expect(await fetchAllPaged('x', fakeTable(1).fetchBatch, 1000)).toHaveLength(1)
  })

  it('does NOT swallow a failure — a partial export must never look complete', async () => {
    // This is the most important assertion here. The old code caught the error
    // and returned [], so a database failure produced an export that read as
    // "this user has no data".
    const failing = async () => {
      throw new Error('connection reset')
    }
    await expect(fetchAllPaged('transactions', failing, 1000)).rejects.toThrow(
      'connection reset',
    )
  })

  /*
   * Reaching DSAR_HARD_CEILING (5,000,000) means 5,000 batches of 1,000, and
   * fetchAllPaged accumulates every row. These two tests therefore build ten
   * million objects between them.
   *
   * They used to mint each id with `${Math.random()}${i}`, adding five million
   * float-to-string conversions per test on top of the allocation. That was
   * slow enough to sit just under vitest's default 5s timeout and pass, and
   * adding ONE unrelated test file to the suite was enough to tip it over —
   * it then failed on every full run while still passing in isolation.
   *
   * A test whose result depends on what else is running is not a gate, and
   * this one guards a DPDP s.11 completeness rule. A cheap monotonic counter
   * gives unique ids for the same assertion at a fraction of the cost, and the
   * explicit timeout states the budget instead of inheriting a default that
   * happened to be near the edge.
   */
  let nextId = 0
  const hugeBatch = async (_c: string | undefined, take: number) =>
    Array.from({ length: take }, () => ({ id: String(nextId++) }))

  it('refuses to continue past the hard ceiling rather than truncate', async () => {
    await expect(
      fetchAllPaged('transactions', hugeBatch, 1000),
    ).rejects.toBeInstanceOf(ExportIncompleteError)
  }, 30_000)

  it('names the failing section so the operator knows what is incomplete', async () => {
    // expect.assertions guards the shape of this test: .catch() with the
    // assertions inside it would pass silently if the call ever stopped
    // rejecting, which is the exact regression being guarded against.
    expect.assertions(3)
    await fetchAllPaged('parties', hugeBatch, 1000).catch((e) => {
      expect(e).toBeInstanceOf(ExportIncompleteError)
      expect((e as ExportIncompleteError).section).toBe('parties')
      expect(String(e)).toContain(DSAR_HARD_CEILING.toLocaleString())
    })
  }, 30_000)
})

describe('the subject-access export path is never degraded', () => {
  // A codemod converting `.catch(() => [])` into a recorded-but-still-swallowed
  // fallback ran across 39 routes. On a DSAR that would be the ORIGINAL bug
  // returning in a smarter disguise: the export would be incomplete, the
  // failure would be noted in a `degraded` array, and the shopkeeper would
  // still receive a document short of the data they are legally owed.
  //
  // DPDP s.11 requires completeness. These sections must PROPAGATE.
  it('user_data sections page to completion, with no swallowing catch', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'app', 'api', 'admin', 'data-exports', 'generate', 'route.ts'),
      'utf8',
    )
    const userDataBlock = src.slice(
      src.indexOf("case 'user_data'"),
      src.indexOf("case 'all_users'"),
    )

    // 2026-07-28: this used to require the literal name `fetchAllPaged`, and
    // broke the moment the route switched to the streaming variant — while the
    // property it cared about (page to completion, never swallow) was still
    // held. Pinning an identifier tests the spelling, not the guarantee.
    //
    // What must remain true: every section pages to completion through one of
    // the completeness helpers, and none of them is capped.
    expect(userDataBlock).toMatch(/(fetchAllPaged|streamAllPaged)/)
    for (const section of ['transactions', 'products', 'parties']) {
      expect(userDataBlock.toLowerCase()).toContain(section)
    }

    // No hardcoded row cap anywhere in the subject-access branch. `take` here
    // must be the batch size handed in by the pager, never a literal — a
    // literal is how the original `take: 1000` truncation happened.
    const codeOnly = userDataBlock
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(codeOnly).not.toMatch(/take:\s*\d+/)

    // Comments must be stripped first. The block contains explanatory comments
    // QUOTING the old `.catch(() => [])` code, and matching those would fail
    // against correct source — the same false-positive that made three guards
    // in the main app fire on code that was right.
    const code = userDataBlock
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    // No swallowed failure anywhere in the subject-access branch.
    expect(code).not.toMatch(/\.catch\(\s*\(\)\s*=>/)
    expect(code).not.toMatch(/\.catch\(ctx\.degrade/)
  })
})

describe('fetchWithTruncationFlag — honest bulk exports', () => {
  it('reports truncated:true when more rows exist', async () => {
    const t = fakeTable(15000)
    const { rows, truncated } = await fetchWithTruncationFlag(
      (take) => t.fetchBatch(undefined, take),
      10000,
    )
    expect(rows).toHaveLength(10000)
    expect(truncated).toBe(true)
  })

  it('reports truncated:false when the data genuinely fits', async () => {
    const t = fakeTable(500)
    const { rows, truncated } = await fetchWithTruncationFlag(
      (take) => t.fetchBatch(undefined, take),
      10000,
    )
    expect(rows).toHaveLength(500)
    expect(truncated).toBe(false)
  })

  it('is correct at exactly the limit — the boundary that hides bugs', async () => {
    // 10,000 rows with a 10,000 limit is NOT truncated. Asking for limit+1 is
    // what distinguishes this from "exactly full, maybe more".
    const t = fakeTable(10000)
    const { rows, truncated } = await fetchWithTruncationFlag(
      (take) => t.fetchBatch(undefined, take),
      10000,
    )
    expect(rows).toHaveLength(10000)
    expect(truncated).toBe(false)
  })

  it('is correct at one row over the limit', async () => {
    const t = fakeTable(10001)
    const { rows, truncated } = await fetchWithTruncationFlag(
      (take) => t.fetchBatch(undefined, take),
      10000,
    )
    expect(rows).toHaveLength(10000)
    expect(truncated).toBe(true)
  })
})
