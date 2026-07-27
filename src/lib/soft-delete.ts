/**
 * DATA DURABILITY — the rules that keep customer records recoverable.
 *
 * THE RULE: the admin panel never destroys a shopkeeper's data. Not with a
 * confirmation prompt, not with a founder session, not with a "are you really
 * sure" flag. Closure is a state change, never a row removal.
 *
 * WHY THIS IS NOT NEGOTIABLE (audit 2026-07-27)
 * ─────────────────────────────────────────────
 * /api/admin/bulk exposed `db.user.deleteMany({ where: { id: { in: userIds } } })`
 * behind a `confirm: "DELETE_PERMANENTLY"` string. 31 relations cascade from
 * User, so that one call permanently destroyed every transaction, product,
 * party, payment and subscription those users had ever recorded.
 *
 * It is also unlawful:
 *   - GST s.36 — books retained 72 months from the annual-return due date
 *   - IT Act Rule 6F / Rule 46(9) — 6 years
 * A shopkeeper's ledger is a statutory record. Destroying it on an admin's
 * click exposes the SHOPKEEPER to penalties for records they are required to
 * produce, for an action they did not take.
 *
 * HOW THIS INTERACTS WITH DPDP ERASURE
 * ────────────────────────────────────
 * DPDP s.12(3) lets a Data Principal demand erasure, BUT s.12(3) itself
 * carves out data retained for compliance with law. So the correct response to
 * "delete my account" is:
 *
 *   1. Close the account          -> deletedAt set, access revoked
 *   2. Scrub erasable identifiers -> anonymise(), for data with no statutory duty
 *   3. Retain the statutory books -> until retentionUntil, then review
 *
 * That satisfies the erasure right AND the retention duty. Refusing outright
 * would breach DPDP; deleting outright would breach the GST and IT Acts.
 *
 * DEFENCE IN DEPTH: this module is the application-level control. It is backed
 * by database-level GRANTs (see prisma/grants/admin-role.sql) which revoke
 * DELETE and TRUNCATE from the admin app's role entirely, so the DATABASE
 * refuses even if this code is wrong or bypassed.
 */

/** Statutory retention floor. The longer of the GST and IT Act obligations. */
export const STATUTORY_RETENTION_YEARS = 8

/**
 * GST s.36 is 72 months from the due date of the annual return, which itself
 * falls the December after the financial year ends. IT Rule 6F is 6 years from
 * the end of the assessment year. Eight years from account closure clears both
 * with margin, and margin is the right call: under-retaining is a penalty,
 * over-retaining costs storage.
 */
export function computeRetentionUntil(closedAt: Date = new Date()): Date {
  const until = new Date(closedAt)
  until.setFullYear(until.getFullYear() + STATUTORY_RETENTION_YEARS)
  return until
}

/** True if the statutory obligation has expired and a purge may be CONSIDERED. */
export function isPurgeEligible(
  retentionUntil: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!retentionUntil) return false // unknown retention = never purge
  return now >= retentionUntil
}

/**
 * Fields scrubbed to satisfy a DPDP erasure request WITHOUT touching the
 * statutory books.
 *
 * Deliberately excludes anything that forms part of the accounting record:
 * transaction amounts, dates, invoice numbers, GSTIN on issued invoices. Those
 * are the record the law requires; they are retained and that retention is the
 * legal defence for refusing to erase them.
 */
export const ANONYMISABLE_USER_FIELDS = [
  'name',
  'phone',
  'image',
  'upiId',
] as const

/** The replacement values written by an anonymisation. One-way. */
export function anonymisedUserPayload(userId: string) {
  return {
    // Email must stay unique and non-null, so it becomes a tombstone rather
    // than being cleared — this keeps the FK graph and audit trail intact.
    email: `anonymised+${userId}@deleted.invalid`,
    name: null,
    phone: null,
    image: null,
    upiId: null,
    anonymisedAt: new Date(),
  }
}

export class DestructiveOperationRefused extends Error {
  constructor(operation: string, guidance: string) {
    super(
      `Refused destructive operation "${operation}". ${guidance} ` +
        `See src/lib/soft-delete.ts for why the admin panel does not delete customer data.`,
    )
    this.name = 'DestructiveOperationRefused'
  }
}

/** Standard filter for every admin query over user-owned data. */
export const NOT_DELETED = { deletedAt: null } as const
