import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Guards the boundary between DETECTING fraud and WATCHING everyone.
 *
 * WHY (audit 2026-07-26/27): three surfaces streamed identifiable shopkeeper
 * activity to any operator who opened a tab —
 *
 *   /api/admin/activity   every sale and purchase, by name and email
 *   /api/admin/overview   the same feed on the dashboard
 *   /api/admin/risk       high-value transactions with userEmail + userName
 *
 * A shopkeeper's ledger is their commercial books, and a transaction row also
 * identifies THEIR customer or supplier — third parties who have no
 * relationship with EkBook and consented to nothing. DPDP s.6 ties processing
 * to a specified purpose, and "an operator opened a tab" is not one.
 *
 * Fraud detection IS a lawful purpose, so detection stays: counts, scores and
 * the duplicate-phone signal are untouched. What is gone is general browsing.
 * Individual transactions now require naming an OPEN fraud alert, which scopes
 * the query to that alert's subject and writes an audit entry.
 *
 * The difference is a reason attached to the access.
 */

const API_ROOT = join(__dirname, '..', 'src', 'app', 'api')

function read(...segments: string[]): string {
  return readFileSync(join(API_ROOT, ...segments), 'utf8')
}

/** Strips comments — several of these files QUOTE the removed code. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 🔒 NOTE (audit 2026-07-28): these patterns match `db.` OR `dbRead.`.
 *
 * §D5 moved read-only analytics onto a replica client, renaming `db.x.find...`
 * to `dbRead.x.find...` in 22 route files. The NEGATIVE guards below — "no
 * route streams identifiable transactions" — matched only `db.`, so after that
 * rename they would have passed while `dbRead.transaction.findMany` sat right
 * there in the file. A privacy guard quietly weakened by an unrelated
 * performance refactor is the worst kind: still green, no longer guarding.
 *
 * Any future client alias must be added here too.
 */

describe('no route streams identifiable transactions', () => {
  it('the activity feed has no transaction event block', () => {
    const code = codeOnly(read('admin', 'activity', 'route.ts'))
    expect(code).not.toMatch(/db(?:Read)?\.transaction\.findMany/)
  })

  it('the dashboard has no transaction event block', () => {
    const code = codeOnly(read('admin', 'overview', 'route.ts'))
    expect(code).not.toMatch(/db(?:Read)?\.transaction\.findMany/)
  })

  it('both still report the transaction COUNT — detection is not the problem', () => {
    // Over-correcting would be its own failure. A founder needs "1,240
    // transactions today"; they do not need to know whose.
    expect(codeOnly(read('admin', 'activity', 'route.ts'))).toMatch(/db(?:Read)?\.transaction\.count/)
    expect(codeOnly(read('admin', 'overview', 'route.ts'))).toMatch(/db(?:Read)?\.transaction\.count/)
  })
})

describe('the risk drill-down requires a case', () => {
  const code = codeOnly(read('admin', 'risk', 'route.ts'))

  it('resolves an alertId before returning any transaction rows', () => {
    expect(code).toMatch(/alertId/)
    expect(code).toMatch(/db(?:Read)?\.fraudAlert\.findUnique/)
    expect(code).toMatch(/alertScope/)
  })

  it('returns NOTHING when no alert is named', () => {
    // The ternary must fall back to an empty list, not to an unscoped query.
    expect(code).toMatch(/alertScope\s*\?[\s\S]{0,1500}?:\s*Promise\.resolve\(\[\]\)/)
  })

  it('scopes the query to the alert subject, not the whole platform', () => {
    const drill = code.slice(code.indexOf('alertScope'), code.indexOf('Total count of high-value'))
    expect(drill).toMatch(/userId:\s*alertScope\.userId/)
  })

  it('refuses a closed alert — a resolved case is not a browsing licence', () => {
    expect(code).toMatch(/ALERT_CLOSED/)
    expect(code).toMatch(/false_positive/)
  })

  it('audits the drill-down', () => {
    // Reading a named shopkeeper's transactions is the most sensitive read in
    // the panel; it must leave a record naming the case it was done under.
    expect(code).toMatch(/fraud_drilldown/)
  })

  it('masks identifiers even inside an authorised drill-down', () => {
    // The investigator needs to correlate rows, not read an address book — and
    // the account is already identified by the alert itself.
    expect(code).toMatch(/maskEmail\(t\.user\?\.email\)/)
    expect(code).toMatch(/maskName\(t\.user\?\.name\)/)
  })
})

describe('ctx.degrade is only used for database calls', () => {
  function findRoutes(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) findRoutes(full, out)
      else if (e === 'route.ts') out.push(full)
    }
    return out
  }

  it('never wraps request-body parsing', () => {
    // A malformed body is the CALLER's mistake, not a degraded system. A
    // codemod wrapped one of these by accident; left in place it would put a
    // section name into degraded[] on every bad request and train operators to
    // ignore that list.
    const offenders = findRoutes(API_ROOT)
      .filter((f) => /json\(\)\.catch\(ctx\.degrade/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(API_ROOT, f).split(sep).slice(0, -1).join('/'))
    expect(
      offenders,
      `ctx.degrade wraps req.json() in: ${offenders.join(', ')}. Use .catch(() => null).`,
    ).toEqual([])
  })
})

