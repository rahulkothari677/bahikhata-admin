import { describe, it, expect } from 'vitest'
import { exportToCsv } from '../src/lib/database-admin'

/**
 * A capped export must say it is capped, in the file.
 *
 * WHY (audit 2026-08-04, Phase 7). Bulk exports used to apply a `take` limit and
 * then set `truncated: false` literally in the result — the export asserted it
 * was complete while being cut short. An earlier fix replaced that with
 * fetchWithTruncationFlag, which asks for limit+1 rows and reports what it
 * actually found. Correct.
 *
 * Nothing read the answer. exportToCsv wrote the header and the rows and
 * dropped `result.truncated` on the floor; no UI displayed it either. So the
 * flag was computed honestly and discarded, and a capped export produced a CSV
 * with no indication whatsoever that rows were missing. Someone opens
 * all_users_2026-08-04.csv, counts the rows, and reasonably concludes that is
 * everyone.
 *
 * A silently incomplete file is worse than a failed one, because it gets used —
 * in a reconciliation, a board number, or a response to a regulator.
 *
 * (Subject-access exports are a separate path: streamAllPaged, never capped.
 * This is about the operator's own bulk dumps.)
 */

const base = {
  columns: ['id', 'email'],
  rows: [['u1', 'a@example.com'], ['u2', 'b@example.com']],
  rowCount: 2,
  durationMs: 0,
}

describe('a truncated export declares itself', () => {
  it('adds an INCOMPLETE EXPORT notice when rows were cut', () => {
    const csv = exportToCsv({ ...base, truncated: true })
    expect(csv).toMatch(/INCOMPLETE EXPORT/)
  })

  it('states the row count it stopped at, so the reader knows the shape of the gap', () => {
    const csv = exportToCsv({ ...base, rowCount: 1000, truncated: true })
    expect(csv).toMatch(/1000/)
  })

  it('puts the notice AFTER the data, so the header and columns are untouched', () => {
    // A notice at the top would shift the header and break every CSV parser.
    const csv = exportToCsv({ ...base, truncated: true })
    const lines = csv.split('\n')
    expect(lines[0]).toBe('id,email')
    expect(lines[1]).toBe('u1,a@example.com')
    expect(lines[2]).toBe('u2,b@example.com')
    expect(csv.indexOf('INCOMPLETE EXPORT')).toBeGreaterThan(csv.indexOf('b@example.com'))
  })

  it('still emits every data row — the notice is added, not substituted', () => {
    const csv = exportToCsv({ ...base, truncated: true })
    expect(csv).toMatch(/a@example\.com/)
    expect(csv).toMatch(/b@example\.com/)
  })
})

describe('a complete export says nothing', () => {
  // The control. Warning on every file would train the reader to ignore it,
  // which is how the original bug would come back wearing a different hat.
  it('adds no notice when the export is complete', () => {
    const csv = exportToCsv({ ...base, truncated: false })
    expect(csv).not.toMatch(/INCOMPLETE/)
    expect(csv).toBe('id,email\nu1,a@example.com\nu2,b@example.com')
  })

  it('returns empty for a result with no columns, truncated or not', () => {
    expect(exportToCsv({ columns: [], rows: [], rowCount: 0, truncated: true, durationMs: 0 })).toBe('')
  })
})
