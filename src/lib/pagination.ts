/**
 * KEYSET (cursor) PAGINATION.
 *
 * WHY (audit 2026-07-27): 22 route files paginate with `skip`/`take`, which
 * compiles to SQL OFFSET. OFFSET does not skip rows cheaply — the database
 * MATERIALISES every skipped row and throws it away. Page 1 is instant; page
 * 5,000 reads five million rows to return twenty. Cost grows linearly with how
 * deep you are, so the admin panel gets slower exactly as the business grows,
 * and each slow query holds a connection the shopkeepers' app also needs.
 *
 * At the scale this product is being built for — millions of users, billions of
 * transactions — OFFSET is not a performance concern, it is an outage.
 *
 * Keyset pagination instead remembers WHERE the last page ended and asks for
 * rows after it. With an index on the sort column that is an index seek: page
 * 5,000 costs the same as page 1.
 *
 *     WHERE (createdAt, id) < (lastCreatedAt, lastId)
 *     ORDER BY createdAt DESC, id DESC
 *     LIMIT 20
 *
 * THE TIE-BREAK MATTERS. Sorting on a non-unique column alone (createdAt) is
 * the classic bug: rows sharing a timestamp can be skipped or repeated across
 * pages, because the database has no stable order within the tie. Every cursor
 * here therefore carries `id` as a final tie-break, and `id` is unique.
 *
 * TRADE-OFF, stated honestly: keyset gives next/previous, not "jump to page
 * 47". That is the right trade for an admin panel — nobody navigates to page 47
 * of a million users, they filter. Where a total is genuinely needed, use an
 * approximate count (see approximateCount) rather than COUNT(*) over the table.
 */

export interface KeysetCursor {
  /** Sort-column value of the last row on the previous page (ISO for dates). */
  v: string
  /** Unique tie-break. Without it, equal sort values are skipped or repeated. */
  id: string
}

/** Opaque to the client so the shape can change without breaking bookmarks. */
export function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | null | undefined): KeysetCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed?.v !== 'string' || typeof parsed?.id !== 'string') return null
    return { v: parsed.v, id: parsed.id }
  } catch {
    // A malformed cursor must not 500. Treat it as "start from the beginning".
    return null
  }
}

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

/** Clamps caller-supplied page size. `?limit=1000000` is not a valid request. */
export function clampPageSize(raw: string | number | null | undefined): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw
  if (!n || Number.isNaN(n) || n < 1) return DEFAULT_PAGE_SIZE
  return Math.min(n, MAX_PAGE_SIZE)
}

/**
 * Builds the Prisma `where` fragment for the next page.
 *
 * @param field   sort column, e.g. 'createdAt'
 * @param cursor  decoded cursor, or null for the first page
 * @param dir     'desc' (newest first, the admin default) or 'asc'
 * @param isDate  parse the cursor value back into a Date
 */
export function keysetWhere(
  field: string,
  cursor: KeysetCursor | null,
  dir: 'asc' | 'desc' = 'desc',
  isDate = true,
): Record<string, unknown> {
  if (!cursor) return {}
  const op = dir === 'desc' ? 'lt' : 'gt'
  const value: unknown = isDate ? new Date(cursor.v) : cursor.v

  // (field, id) < (v, id) expressed as Prisma OR — strictly past the sort
  // value, OR equal to it and strictly past the id. The second branch is what
  // stops rows with identical timestamps being skipped or duplicated.
  return {
    OR: [
      { [field]: { [op]: value } },
      { AND: [{ [field]: value }, { id: { [op]: cursor.id } }] },
    ],
  }
}

/** Stable ordering. The `id` tie-break is not optional — see keysetWhere. */
export function keysetOrderBy(
  field: string,
  dir: 'asc' | 'desc' = 'desc',
): Array<Record<string, 'asc' | 'desc'>> {
  return [{ [field]: dir }, { id: dir }]
}

export interface KeysetPage<T> {
  rows: T[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Runs a keyset query. Fetches pageSize + 1 to learn whether another page
 * exists WITHOUT a second COUNT query.
 */
export async function keysetPaginate<T extends Record<string, unknown>>(
  fetchRows: (take: number) => Promise<T[]>,
  pageSize: number,
  field: string,
): Promise<KeysetPage<T>> {
  const rows = await fetchRows(pageSize + 1)
  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows

  let nextCursor: string | null = null
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1]
    const raw = last[field]
    nextCursor = encodeCursor({
      v: raw instanceof Date ? raw.toISOString() : String(raw),
      id: String(last.id),
    })
  }

  return { rows: page, nextCursor, hasMore }
}

/**
 * Row-count estimate from the planner's statistics — O(1) regardless of table
 * size, where COUNT(*) is a full scan.
 *
 * Use for "~2.3M users" style displays. Do NOT use where the number must be
 * exact (billing, reconciliation, a legal export). It is approximate by
 * definition and drifts between ANALYZE runs.
 */
export async function approximateCount(
  raw: (sql: string) => Promise<Array<{ estimate: bigint | number }>>,
  table: string,
): Promise<number> {
  const rows = await raw(
    `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = '${table}'`,
  )
  const est = rows?.[0]?.estimate
  return est == null ? 0 : Number(est)
}
