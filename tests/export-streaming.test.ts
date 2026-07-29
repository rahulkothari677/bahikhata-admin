import { describe, it, expect, vi } from 'vitest'
import { streamAllPaged, DSAR_HARD_CEILING, ExportIncompleteError } from '../src/lib/export-pagination'
import { escapeCsv } from '../src/lib/database-admin'

/**
 * WHY (audit 2026-07-28): the DPDP s.11 subject-access export fetched every row
 * into arrays and then concatenated them into one string — two full copies of a
 * shopkeeper's ledger alive at once in a serverless function with a fixed
 * memory ceiling. It worked for a corner shop and would be OOM-killed for a
 * successful one, on a legal request, for the users with the most data.
 *
 * It also built its CSV by hand with `String(v || '')`, which silently turned
 * every zero into an empty cell.
 */

describe('streamAllPaged does not accumulate', () => {
  it('hands over each batch and keeps no reference to it', async () => {
    const PAGES = 5
    const BATCH = 1000
    let served = 0

    const seen: number[] = []
    const total = await streamAllPaged<{ id: string }>(
      'transactions',
      async (_cursor, take) => {
        if (served >= PAGES * BATCH) return []
        const batch = Array.from({ length: take }, (_v, i) => ({ id: `id-${served + i}` }))
        served += take
        return batch
      },
      batch => { seen.push(batch.length) },
      BATCH,
    )

    expect(total).toBe(PAGES * BATCH)
    // Every batch was handed over separately — the caller never received one
    // array of 5,000.
    expect(seen).toEqual([1000, 1000, 1000, 1000, 1000, 0])
  })

  it('pages with a keyset cursor, never OFFSET', async () => {
    const cursors: Array<string | undefined> = []
    let round = 0
    await streamAllPaged<{ id: string }>(
      'products',
      async (cursor, take) => {
        cursors.push(cursor)
        if (round++ >= 2) return []
        return Array.from({ length: take }, (_v, i) => ({ id: `row-${round}-${i}` }))
      },
      () => {},
      10,
    )
    // First call has no cursor; each later call resumes from the last id of the
    // previous batch rather than skipping N rows.
    expect(cursors[0]).toBeUndefined()
    expect(cursors[1]).toBe('row-1-9')
    expect(cursors[2]).toBe('row-2-9')
  })

  it('propagates a mid-export failure instead of returning a short result', async () => {
    // A partial export that looks complete is the exact defect this route was
    // built to remove. Half a ledger must never be presented as a whole one.
    let n = 0
    await expect(
      streamAllPaged<{ id: string }>(
        'transactions',
        async (_c, take) => {
          if (n++ === 1) throw new Error('connection reset mid-export')
          return Array.from({ length: take }, (_v, i) => ({ id: `x${i}` }))
        },
        () => {},
        10,
      ),
    ).rejects.toThrow('connection reset mid-export')
  })

  it('refuses to run away past the hard ceiling', async () => {
    const onBatch = vi.fn()
    await expect(
      streamAllPaged<{ id: string }>(
        'transactions',
        async (_c, take) => Array.from({ length: take }, (_v, i) => ({ id: `y${i}` })),
        onBatch,
        DSAR_HARD_CEILING, // one batch is already at the ceiling; the next trips it
      ),
    ).rejects.toBeInstanceOf(ExportIncompleteError)
  })
})

describe('escapeCsv writes what the value actually is', () => {
  it('keeps a zero as 0, not an empty cell', () => {
    // THE bug. `String(v || '')` mapped 0 to ''. On a money column in a legal
    // export that is silent corruption: a zero-value bill exported as blank.
    expect(escapeCsv(0)).toBe('0')
  })

  it('keeps false as false', () => {
    expect(escapeCsv(false)).toBe('false')
  })

  it('still writes an empty cell for null and undefined', () => {
    expect(escapeCsv(null)).toBe('')
    expect(escapeCsv(undefined)).toBe('')
  })

  it('quotes a party name containing a comma so columns do not shift', () => {
    expect(escapeCsv('Sharma, Ram')).toBe('"Sharma, Ram"')
  })

  it('doubles embedded quotes', () => {
    expect(escapeCsv('the "big" shop')).toBe('"the ""big"" shop"')
  })

  it('quotes a note containing a newline', () => {
    expect(escapeCsv('line one\nline two')).toBe('"line one\nline two"')
  })

  it('writes dates in ISO, not the server locale', () => {
    expect(escapeCsv(new Date('2026-07-28T10:20:30.000Z'))).toBe('2026-07-28T10:20:30.000Z')
  })

  describe('CSV formula injection', () => {
    // These exports carry shopkeeper-supplied text and are opened by operators
    // and regulators in Excel. A cell starting with = is executed.
    it('neutralises a formula in a text field', () => {
      expect(escapeCsv('=1+1')).toBe("'=1+1")
      expect(escapeCsv('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)")
    })

    it('does NOT mangle a negative amount', () => {
      // A negative number must stay numeric — guarding it would corrupt every
      // credit note in the export.
      expect(escapeCsv(-500)).toBe('-500')
      expect(escapeCsv(-0.5)).toBe('-0.5')
    })

    it('quotes AND guards a value that needs both', () => {
      expect(escapeCsv('=cmd,danger')).toBe('"\'=cmd,danger"')
    })
  })
})
