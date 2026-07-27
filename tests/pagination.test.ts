import { describe, it, expect } from 'vitest'
import {
  encodeCursor,
  decodeCursor,
  clampPageSize,
  keysetWhere,
  keysetOrderBy,
  keysetPaginate,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from '../src/lib/pagination'

/**
 * Guards for keyset pagination.
 *
 * WHY (audit 2026-07-27): 22 route files paginated with skip/take -> SQL
 * OFFSET, which materialises and discards every skipped row. Page 5,000 reads
 * five million rows to return twenty, while holding a connection the
 * shopkeepers' app needs. At the scale this product targets that is an outage,
 * not a slow page.
 *
 * The subtle bug these tests exist for is the TIE-BREAK. Paging on a
 * non-unique column alone (createdAt) silently skips or repeats rows that
 * share a value — and timestamps collide constantly under bulk inserts. Every
 * cursor therefore carries a unique `id`.
 */

describe('cursor encoding', () => {
  it('round-trips', () => {
    const c = { v: '2026-07-27T10:00:00.000Z', id: 'usr_abc' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
  })

  it('treats a malformed cursor as "start from the beginning", not a crash', () => {
    // A cursor arrives from a URL. Users edit URLs, bookmarks go stale, bots
    // fuzz them. None of that may produce a 500.
    expect(decodeCursor('not-base64!!')).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor(Buffer.from('{"nope":1}').toString('base64url'))).toBeNull()
  })

  it('is opaque, so the shape can change without breaking bookmarks', () => {
    expect(encodeCursor({ v: '2026-01-01', id: 'x' })).not.toContain('2026')
  })
})

describe('page size clamping', () => {
  it('caps absurd requests', () => {
    // ?limit=1000000 is not a valid request; it is a denial of service.
    expect(clampPageSize('1000000')).toBe(MAX_PAGE_SIZE)
    expect(clampPageSize(99999)).toBe(MAX_PAGE_SIZE)
  })

  it('falls back to the default for junk', () => {
    expect(clampPageSize('abc')).toBe(DEFAULT_PAGE_SIZE)
    expect(clampPageSize('0')).toBe(DEFAULT_PAGE_SIZE)
    expect(clampPageSize('-5')).toBe(DEFAULT_PAGE_SIZE)
    expect(clampPageSize(null)).toBe(DEFAULT_PAGE_SIZE)
  })

  it('honours a reasonable request', () => {
    expect(clampPageSize('50')).toBe(50)
  })
})

describe('keyset where clause', () => {
  it('is empty on the first page', () => {
    expect(keysetWhere('createdAt', null)).toEqual({})
  })

  it('ALWAYS includes the id tie-break', () => {
    // The load-bearing assertion. Without the second OR branch, rows sharing a
    // createdAt are skipped or repeated across page boundaries — and bulk
    // inserts produce identical timestamps constantly.
    const w = keysetWhere('createdAt', { v: '2026-07-27T10:00:00.000Z', id: 'usr_5' }) as any
    expect(w.OR).toHaveLength(2)
    expect(w.OR[1].AND[1].id).toEqual({ lt: 'usr_5' })
  })

  it('flips comparison direction with sort order', () => {
    const desc = keysetWhere('createdAt', { v: '2026-01-01', id: 'a' }, 'desc') as any
    const asc = keysetWhere('createdAt', { v: '2026-01-01', id: 'a' }, 'asc') as any
    expect(Object.keys(desc.OR[0].createdAt)[0]).toBe('lt')
    expect(Object.keys(asc.OR[0].createdAt)[0]).toBe('gt')
  })

  it('parses date cursors back to Date objects', () => {
    const w = keysetWhere('createdAt', { v: '2026-07-27T10:00:00.000Z', id: 'x' }, 'desc', true) as any
    expect(w.OR[0].createdAt.lt).toBeInstanceOf(Date)
  })

  it('leaves string cursors as strings', () => {
    const w = keysetWhere('id', { v: 'abc', id: 'abc' }, 'desc', false) as any
    expect(typeof w.OR[0].id.lt).toBe('string')
  })
})

describe('keyset order by', () => {
  it('always appends the id tie-break', () => {
    expect(keysetOrderBy('createdAt', 'desc')).toEqual([
      { createdAt: 'desc' }, { id: 'desc' },
    ])
  })

  it('keeps the tie-break in the SAME direction as the sort', () => {
    // Mismatched directions break the (a,b) < (x,y) comparison the where
    // clause encodes, which silently drops rows.
    const [, tie] = keysetOrderBy('createdAt', 'asc')
    expect(tie).toEqual({ id: 'asc' })
  })
})

describe('keysetPaginate', () => {
  const makeRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `id_${String(i).padStart(4, '0')}`,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    }))

  it('detects another page WITHOUT a second COUNT query', async () => {
    // Fetching pageSize+1 is what avoids COUNT(*) over the whole table on
    // every page load.
    let requested = 0
    const page = await keysetPaginate(
      async (take) => { requested = take; return makeRows(take) },
      25, 'createdAt',
    )
    expect(requested).toBe(26)
    expect(page.rows).toHaveLength(25)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).not.toBeNull()
  })

  it('reports the last page correctly', async () => {
    const page = await keysetPaginate(async () => makeRows(10), 25, 'createdAt')
    expect(page.rows).toHaveLength(10)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('is correct at exactly a full page', async () => {
    // 25 rows with pageSize 25: NOT more. Asking for 26 is what distinguishes
    // "exactly full" from "full, and there is more".
    const page = await keysetPaginate(async () => makeRows(25), 25, 'createdAt')
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('handles an empty result', async () => {
    const page = await keysetPaginate(async () => [], 25, 'createdAt')
    expect(page.rows).toHaveLength(0)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('builds the next cursor from the LAST row of the page', async () => {
    const page = await keysetPaginate(async (take) => makeRows(take), 5, 'createdAt')
    const cursor = decodeCursor(page.nextCursor)!
    expect(cursor.id).toBe('id_0004') // 5th row, not the 6th lookahead row
  })

  it('walks the whole set with no duplicates and no gaps', async () => {
    // The end-to-end property that matters: paging through must visit every
    // row exactly once.
    const all = makeRows(53)
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 20; guard++) {
      const page: any = await keysetPaginate(
        async (take) => {
          const c = decodeCursor(cursor)
          const start = c ? all.findIndex((r) => r.id === c.id) + 1 : 0
          return all.slice(start, start + take)
        },
        10, 'createdAt',
      )
      seen.push(...page.rows.map((r: any) => r.id))
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(53)
    expect(new Set(seen).size).toBe(53)
    expect(seen).toEqual(all.map((r) => r.id))
  })
})
