/**
 * Export completeness helpers.
 *
 * WHY (audit 2026-07-26): /api/admin/data-exports/generate had three
 * compounding defects that together produce a legally defective document.
 *
 *  1. A DPDP access request (a "user_data" export) capped each section at
 *     `take: 1000`. A shopkeeper with 4,000 transactions received 1,000 of
 *     them, with nothing indicating the rest existed. DPDP s.11 gives the Data
 *     Principal a right to a SUMMARY OF ALL personal data being processed —
 *     silently serving 25% of it does not discharge that.
 *
 *  2. Bulk exports applied `take: 10000` and then set `truncated: false`
 *     literally in the payload. The export asserted it was complete while
 *     being truncated.
 *
 *  3. Every query was wrapped in `.catch(() => [])`, so a failed section
 *     produced an export that was simply MISSING that data — no error, no
 *     warning. That is the worst of the three: it is indistinguishable from
 *     "this user has no transactions".
 *
 * The rule these helpers encode: an export is either COMPLETE, or it says
 * loudly that it is not. It must never quietly be neither.
 */

/** Rows beyond this in a single subject-access export mean something is wrong. */
export const DSAR_HARD_CEILING = 5_000_000

export class ExportIncompleteError extends Error {
  constructor(
    message: string,
    readonly section: string,
  ) {
    super(message)
    this.name = 'ExportIncompleteError'
  }
}

/**
 * Fetches EVERY row for a subject-access export, in batches.
 *
 * Deliberately NOT capped at an arbitrary limit. One shopkeeper's own data is
 * naturally bounded — this scales with that user, not with the size of the
 * table — so paging to completion is both correct and safe. It is the whole
 * point: a subject access request must return everything.
 *
 * Failures are NOT swallowed. If a batch throws, the caller must fail the
 * export rather than hand the user a partial document that looks complete.
 */
export async function fetchAllPaged<T extends { id: string }>(
  section: string,
  fetchBatch: (cursor: string | undefined, take: number) => Promise<T[]>,
  batchSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  let cursor: string | undefined

  // Keyset pagination, not OFFSET. OFFSET re-scans and discards every skipped
  // row, so page N costs O(N * pageSize) and a large export degrades to a
  // crawl while holding a connection the shopkeepers' app also needs.
  for (;;) {
    const batch = await fetchBatch(cursor, batchSize)
    all.push(...batch)

    if (batch.length < batchSize) break

    if (all.length > DSAR_HARD_CEILING) {
      throw new ExportIncompleteError(
        `Export exceeded ${DSAR_HARD_CEILING.toLocaleString()} rows in section "${section}". ` +
          `Refusing to produce a document that would be silently incomplete. ` +
          `Investigate before retrying.`,
        section,
      )
    }

    cursor = batch[batch.length - 1].id
  }

  return all
}

/**
 * Runs a bounded query and reports HONESTLY whether more rows exist, by asking
 * for one more row than the limit. Replaces hardcoding `truncated: false`.
 */
export async function fetchWithTruncationFlag<T>(
  fetchBatch: (take: number) => Promise<T[]>,
  limit: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows = await fetchBatch(limit + 1)
  if (rows.length > limit) {
    return { rows: rows.slice(0, limit), truncated: true }
  }
  return { rows, truncated: false }
}
