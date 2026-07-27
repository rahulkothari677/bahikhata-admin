/**
 * Reports findMany calls with no `take`.
 *
 * An unbounded findMany is a table scan waiting to happen: it works on a
 * developer's 50-row database and returns a million rows in production,
 * exhausting memory in a serverless function that has 1GB and no swap.
 *
 * Deliberately REPORTS rather than auto-patching. A blind `take: 1000` on a
 * query whose caller assumes completeness silently truncates — which is the
 * bug just fixed in the DSAR export, reintroduced by a codemod. Each of these
 * needs a human decision: cap it, page it, or aggregate it.
 *
 * Run: node scripts/cap-unbounded-queries.mjs
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith('.ts')) out.push(full)
  }
  return out
}

const findings = []

for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split(/\r?\n/)

  const re = /\.findMany\(\s*\{([\s\S]{0,800}?)\n\s*\}\s*\)/g
  let m
  while ((m = re.exec(src)) !== null) {
    if (/\btake\s*:/.test(m[1])) continue
    const lineNo = src.slice(0, m.index).split(/\r?\n/).length
    const model = (src.slice(Math.max(0, m.index - 60), m.index).match(/(\w+)\.$/) || [])[1] ?? '?'
    findings.push({
      file: relative('src', file),
      line: lineNo,
      model,
      // A per-user query is naturally bounded by that user's data; a global one
      // is bounded by the size of the table. Very different risk.
      scoped: /userId|where:\s*\{\s*id\b/.test(m[1]),
      snippet: (lines[lineNo - 1] || '').trim().slice(0, 70),
    })
  }
}

const unscoped = findings.filter((f) => !f.scoped)
const scoped = findings.filter((f) => f.scoped)

console.log(`${findings.length} findMany calls without a take.`)
console.log(`  ${unscoped.length} UNSCOPED  — bounded only by table size. These are the risk.`)
console.log(`  ${scoped.length} scoped     — bounded by one user's data.\n`)

console.log('UNSCOPED:')
for (const f of unscoped) {
  console.log(`  ${f.file}:${f.line}  ${f.model}.findMany  ${f.snippet}`)
}
