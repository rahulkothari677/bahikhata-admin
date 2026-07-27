import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import {
  computeRetentionUntil,
  isPurgeEligible,
  anonymisedUserPayload,
  STATUTORY_RETENTION_YEARS,
} from '../src/lib/soft-delete'

/**
 * Guards for data durability — the founder's stated top priority: customer
 * data must never be lost, "at any cost, no matter what".
 *
 * WHY (audit 2026-07-27): /api/admin/bulk exposed
 *     db.user.deleteMany({ where: { id: { in: userIds } } })
 * behind a `confirm: "DELETE_PERMANENTLY"` string. 31 relations cascade from
 * User, so one API call permanently destroyed every transaction, product,
 * party, payment and subscription those shopkeepers had ever recorded.
 *
 * It was also unlawful — GST s.36 (72 months) and IT Rule 6F (6 years) make
 * those books a statutory record. Destroying them exposes the SHOPKEEPER to
 * penalties for records they are required to produce, over an action an admin
 * took rather than them.
 */

const API_ROOT = join(__dirname, '..', 'src', 'app', 'api')

function findRouteFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) findRouteFiles(full, out)
    else if (e === 'route.ts') out.push(full)
  }
  return out
}

const routeKeyFor = (f: string) =>
  relative(API_ROOT, f).split(sep).slice(0, -1).join('/')

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/**
 * Models holding CUSTOMER data. Destroying any of these loses a shopkeeper's
 * records and is never permitted from the admin app.
 *
 * (Admin-owned operational rows — a webhook endpoint, a competitor note, a
 * campaign — are a different matter and may still be deleted outright.)
 */
const CUSTOMER_DATA_MODELS = [
  'user',
  'transaction',
  'transactionItem',
  'product',
  'party',
  'payment',
  'subscription',
  'document',
  'gstReturn',
  'bankStatement',
  'bankTransaction',
]

describe('no route destroys customer data', () => {
  const routeFiles = findRouteFiles(API_ROOT)

  it('finds route files (guards against a broken walker)', () => {
    expect(routeFiles.length).toBeGreaterThan(50)
  })

  it.each(CUSTOMER_DATA_MODELS)(
    'no route calls db.%s.delete/deleteMany',
    (model) => {
      const pattern = new RegExp(`db\\.${model}\\.(delete|deleteMany)\\s*\\(`)
      const offenders = routeFiles
        .filter((f) => pattern.test(codeOnly(readFileSync(f, 'utf8'))))
        .map(routeKeyFor)
      expect(
        offenders,
        `These routes destroy customer data in "${model}":\n  ${offenders.join('\n  ')}\n` +
          `Close the account instead (deletedAt + retentionUntil). ` +
          `See src/lib/soft-delete.ts.`,
      ).toEqual([])
    },
  )

  it('no route issues raw DELETE or TRUNCATE SQL', () => {
    const offenders = routeFiles
      .filter((f) => {
        const code = codeOnly(readFileSync(f, 'utf8'))
        return /\$executeRaw[\s\S]{0,200}(DELETE\s+FROM|TRUNCATE)/i.test(code)
      })
      .map(routeKeyFor)
    expect(offenders, offenders.join('\n  ')).toEqual([])
  })

  it('the bulk close path bumps tokenVersion', () => {
    // Soft delete leaves the row present, so unless tokenVersion is bumped the
    // closed account's existing JWTs keep working in the MAIN app until they
    // expire — closure would be cosmetic. The old hard delete revoked access as
    // a side effect of the row vanishing; nothing replaces that automatically.
    const bulk = readFileSync(join(API_ROOT, 'admin', 'bulk', 'route.ts'), 'utf8')
    const deleteCase = bulk.slice(bulk.indexOf("case 'delete'"))
    expect(deleteCase).toMatch(/tokenVersion:\s*\{\s*increment:\s*1\s*\}/)
    expect(deleteCase).toMatch(/deletedAt/)
    expect(deleteCase).toMatch(/retentionUntil/)
  })
})

describe('statutory retention', () => {
  it('retains for at least the GST 72-month obligation', () => {
    // GST s.36: 72 months from the annual-return due date, which itself falls
    // after the financial year ends. 6 years is the floor; we keep 8.
    expect(STATUTORY_RETENTION_YEARS).toBeGreaterThanOrEqual(6)
  })

  it('computes a retention date the correct distance out', () => {
    const closed = new Date('2026-07-27T00:00:00Z')
    const until = computeRetentionUntil(closed)
    expect(until.getUTCFullYear()).toBe(2026 + STATUTORY_RETENTION_YEARS)
  })

  it('never treats an unknown retention date as purge-eligible', () => {
    // The dangerous default. A missing retentionUntil must mean "never purge",
    // not "no constraint".
    expect(isPurgeEligible(null)).toBe(false)
    expect(isPurgeEligible(undefined)).toBe(false)
  })

  it('is not purge-eligible before the retention date', () => {
    const until = new Date('2034-01-01')
    expect(isPurgeEligible(until, new Date('2033-12-31'))).toBe(false)
  })

  it('becomes purge-eligible only after the retention date', () => {
    const until = new Date('2034-01-01')
    expect(isPurgeEligible(until, new Date('2034-01-02'))).toBe(true)
  })
})

describe('DPDP anonymisation', () => {
  const payload = anonymisedUserPayload('usr_abc123')

  it('scrubs the erasable identifiers', () => {
    expect(payload.name).toBeNull()
    expect(payload.phone).toBeNull()
    expect(payload.image).toBeNull()
    expect(payload.upiId).toBeNull()
  })

  it('keeps email unique and non-null rather than clearing it', () => {
    // email is UNIQUE and NOT NULL. Clearing it would either violate the
    // constraint or collide across anonymised users, breaking the FK graph and
    // the audit trail. A tombstone preserves both.
    expect(payload.email).toContain('usr_abc123')
    expect(payload.email).toMatch(/@deleted\.invalid$/)
  })

  it('records when anonymisation happened', () => {
    expect(payload.anonymisedAt).toBeInstanceOf(Date)
  })

  it('does NOT touch the statutory accounting record', () => {
    // Transaction amounts, dates and invoice numbers are the record the law
    // requires. Retaining them is the lawful basis for refusing to erase them.
    const keys = Object.keys(payload)
    for (const forbidden of ['totalAmount', 'invoiceNumber', 'date', 'gstin']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
