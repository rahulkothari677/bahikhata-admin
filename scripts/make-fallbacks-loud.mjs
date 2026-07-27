/**
 * Makes the remaining silent fallbacks in src/lib LOG before degrading.
 *
 * Route handlers got ctx.degrade(), which records the failure into the
 * response. Library functions have no request context, so they cannot report
 * to the client — but they can stop failing in total silence, which is what
 * `.catch(() => [])` does today: no log line, no metric, nothing.
 *
 * Run: node scripts/make-fallbacks-loud.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, relative, basename } from 'path'

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith('.ts')) out.push(full)
  }
  return out
}

const SKIP = ['pagination.ts', 'export-pagination.ts', 'degradable.ts', 'with-admin.ts']

let converted = 0
const touched = []

for (const file of walk('src/lib')) {
  if (SKIP.some((s) => file.endsWith(s))) continue

  const src = readFileSync(file, 'utf8')
  const name = basename(file)
  let count = 0

  let next = src.replace(
    /\.catch\(\(\)\s*=>\s*(\[\]|0|null|-1)\)/g,
    (_m, fallback) => {
      count++
      return `.catch((e) => { console.error('[fallback] ${name}:', e); return ${fallback} })`
    },
  )

  // Object-literal fallbacks — `.catch(() => ({ _sum: { amount: 0 } }))`.
  // These are the MONEY ones: an aggregate that silently returns zero is how a
  // P&L reports no revenue during a database blip and nobody can tell.
  next = next.replace(
    /\.catch\(\(\)\s*=>\s*(\(\{[^}]*\}[^)]*\))\)/g,
    (_m, fallback) => {
      count++
      return `.catch((e) => { console.error('[fallback] ${name}:', e); return ${fallback} })`
    },
  )

  if (count > 0) {
    writeFileSync(file, next)
    converted += count
    touched.push(`${relative('src', file)} (${count})`)
  }
}

console.log(`Made ${converted} silent fallbacks loud across ${touched.length} files`)
for (const t of touched) console.log('  ' + t)
