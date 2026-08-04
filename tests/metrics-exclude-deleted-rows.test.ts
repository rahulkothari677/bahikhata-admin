import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Reporting metrics must not count soft-deleted rows.
 *
 * WHY (audit 2026-08-04, Phase 7). Found live, not by reading code: created a
 * ₹2,360 sale in the main app, watched admin GMV rise by exactly ₹2,360 and the
 * transaction count by 1, then deleted the sale. It vanished from the
 * shopkeeper's books (404) and BOTH admin figures stayed where they were.
 *
 * GMV could therefore only ever go up. Every deleted invoice, test entry and
 * mistyped sale ever made on the platform was still in the founder's headline
 * number, and nothing would have removed it.
 *
 * The sweep that followed found 33 such queries. The pattern was stark: every
 * `user.count` on the same lines correctly carried `deletedAt: null` and the
 * transaction ones did not, so this had been drifting one query at a time.
 *
 * Two of those places mattered more than the dashboard:
 *   - gst-filing.ts, which ALSO bucketed the period by `createdAt` (when the row
 *     was written) instead of `date` (the invoice date). A 31 July invoice
 *     entered on 2 August landed in August here and in July in the shopkeeper's
 *     actual return. Deleted invoices were counted as outward supply on top.
 *   - compute-daily-stats, which WRITES a rollup row — a wrong number there is
 *     baked into stored history and read back later as fact.
 *
 * The main app is the authority for anything a shopkeeper also sees: it
 * excludes soft-deleted rows from every GST surface without exception.
 *
 * Deliberate exceptions are listed below and each is annotated at its call site.
 */

const ROOT = path.resolve(__dirname, '..', 'src')

/**
 * Files where an UNFILTERED query is correct, with the reason. Anything not on
 * this list must filter. Adding an entry here should require the same thought
 * as the comment at the call site.
 */
const DELIBERATE_EXCEPTIONS: Record<string, string> = {
  'lib/fraud-rules-engine.ts':
    'Creating transactions then deleting them is the laundering pattern these rules detect.',
  'app/api/admin/risk/route.ts':
    'Same as fraud-rules-engine: a row disappearing is the signal, not noise.',
  'app/api/admin/validate-data/route.ts':
    'Integrity check on the table itself — must see what is actually stored.',
  'app/api/admin/data-exports/generate/route.ts':
    'DPDP s.11 subject access: a soft-deleted row is still HELD, and is retained under GST s.36.',
  'lib/prisma-money-extension.ts':
    'Defines the extension handlers themselves; contains no query of its own.',
}

const SOFT_DELETABLE = ['transaction', 'party', 'payment', 'document']

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

/** Slice from `start` to the matching close paren. */
function callArgs(src: string, start: number): string {
  let depth = 0
  for (let i = start; i < src.length && i < start + 4000; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  return src.slice(start, start + 600)
}

interface Site { rel: string; line: number; call: string }

function findUnfilteredSites(): Site[] {
  const sites: Site[] = []
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const rel = path.relative(ROOT, file).split(path.sep).join('/')

    for (const model of SOFT_DELETABLE) {
      const re = new RegExp(`\\.${model}\\.(count|aggregate|groupBy|findMany|findFirst)\\s*\\(`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        // `db.$transaction(` is not the Transaction model.
        if (src[m.index - 1] === '$') continue
        const open = src.indexOf('(', m.index + m[0].length - 1)
        const args = callArgs(src, open)
        if (/deletedAt/.test(args)) continue
        sites.push({ rel, line: src.slice(0, m.index).split('\n').length, call: `${model}.${m[1]}` })
      }
    }
  }
  return sites
}

const unfiltered = findUnfilteredSites()

describe('admin reporting metrics exclude soft-deleted rows', () => {
  it('scans a realistic number of files — a zero here would make this vacuous', () => {
    expect(walk(ROOT).length).toBeGreaterThan(50)
  })

  it('finds no unfiltered query outside the deliberate exceptions', () => {
    const offenders = unfiltered.filter((s) => !(s.rel in DELIBERATE_EXCEPTIONS))
    expect(
      offenders.map((s) => `${s.rel}:${s.line} ${s.call}`),
    ).toEqual([])
  })

  it('keeps the exception list honest — every entry still has an unfiltered query', () => {
    // If a file stops needing its exemption, the entry should go, so the list
    // never grows into a place where real offenders can hide.
    const stillNeeded = new Set(unfiltered.map((s) => s.rel))
    const stale = Object.keys(DELIBERATE_EXCEPTIONS).filter((f) => !stillNeeded.has(f))
    expect(stale).toEqual([])
  })
})

describe('GST filing agrees with what the shopkeeper actually files', () => {
  const gst = fs.readFileSync(path.join(ROOT, 'lib/gst-filing.ts'), 'utf8').replace(/\r\n/g, '\n')

  it('buckets the period by invoice date, not by row-creation time', () => {
    // A back-dated invoice — routine, since the whole point is catching up on
    // paperwork — must land in the period it was issued in.
    expect(gst).not.toMatch(/createdAt: \{ gte: periodStart/)
    expect(gst).toMatch(/date: \{ gte: periodStart/)
    expect(gst).toMatch(/date: \{ gte: thisMonthStart/)
    expect(gst).toMatch(/date: \{ gte: lastMonthStart/)
  })

  it('excludes deleted invoices from every aggregate', () => {
    const queries = gst.match(/db\.transaction\.(findMany|aggregate)\(\{[\s\S]*?\n\s{4}\}\)/g) || []
    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) expect(q).toMatch(/deletedAt: null/)
  })
})
