/**
 * Codemod: migrate admin API routes onto withAdmin().
 *
 * Mechanical and uniform — every route currently opens with the same three
 * lines of session boilerplate. Doing 70+ of these by hand is slow AND more
 * error-prone than a codemod verified by tsc + the test suite.
 *
 * Uses BRACE MATCHING, not regex, to find each handler's end. A regex for the
 * closing brace would happily match the end of a nested function.
 *
 * Skips: public routes (no session at all), and files already migrated.
 *
 * Run:  node scripts/migrate-to-with-admin.mjs [--dry]
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const API_ROOT = join(process.cwd(), 'src', 'app', 'api')
const DRY = process.argv.includes('--dry')

/** Public routes — authentication is the point, or there is deliberately none. */
const SKIP = new Set([
  'auth/[...nextauth]',
  'admin/setup',
  'admin/forgot-password',
  'admin/login-probe',
  'status',
])

function findRouteFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) findRouteFiles(full, out)
    else if (e === 'route.ts') out.push(full)
  }
  return out
}

const routeKeyFor = (f) => relative(API_ROOT, f).split(sep).slice(0, -1).join('/')

/** Index of the brace matching the one at `start`, ignoring strings/comments. */
function matchBrace(src, start) {
  let depth = 0
  let i = start
  let inLine = false, inBlock = false, inStr = null
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (inLine) { if (c === '\n') inLine = false }
    else if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ } }
    else if (inStr) {
      if (c === '\\') i++
      else if (c === inStr) inStr = null
    }
    else if (c === '/' && n === '/') { inLine = true; i++ }
    else if (c === '/' && n === '*') { inBlock = true; i++ }
    else if (c === '"' || c === "'" || c === '`') inStr = c
    else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
    i++
  }
  return -1
}

let migrated = 0, skipped = 0
const report = []

for (const file of findRouteFiles(API_ROOT)) {
  const key = routeKeyFor(file)
  if (SKIP.has(key)) { skipped++; continue }

  let src = readFileSync(file, 'utf8')
  if (/export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\s*=\s*withAdmin\s*\(/.test(src)) {
    skipped++; continue
  }

  const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g
  const edits = []
  let m
  while ((m = HANDLER.exec(src)) !== null) {
    const method = m[1]
    const parenStart = m.index + m[0].length - 1

    // Find the end of the parameter list.
    let depth = 0, i = parenStart, parenEnd = -1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') { depth--; if (depth === 0) { parenEnd = i; break } }
    }
    if (parenEnd === -1) continue

    const paramsText = src.slice(parenStart + 1, parenEnd)
    const braceStart = src.indexOf('{', parenEnd)
    if (braceStart === -1) continue
    const braceEnd = matchBrace(src, braceStart)
    if (braceEnd === -1) continue

    // Preserve the caller's first-parameter name (req / request / _req).
    const firstParam = (paramsText.match(/^\s*(\w+)\s*:/) || [])[1] || 'req'
    const hasParams = /\bparams\b/.test(paramsText)
    const reqType = /NextRequest/.test(paramsText) ? 'NextRequest' : 'NextRequest'

    const newSig =
      `export const ${method} = withAdmin(\n  '${key}',\n  async (${firstParam}: ${reqType}, ctx` +
      (hasParams ? ', { params }' : '') +
      `) => {`

    edits.push({ start: m.index, sigEnd: braceStart + 1, braceEnd, newSig })
  }

  if (edits.length === 0) { skipped++; continue }

  // Apply from the end so earlier offsets stay valid.
  for (const e of edits.reverse()) {
    src = src.slice(0, e.braceEnd) + '},\n)' + src.slice(e.braceEnd + 1)
    src = src.slice(0, e.start) + e.newSig + src.slice(e.sigEnd)
  }

  // Drop the session boilerplate the wrapper now owns.
  src = src.replace(
    /^\s*const session = await getServerSession\(authOptions\)\s*\n/gm, '')
  src = src.replace(
    /^\s*if \(!session\)[^\n]*\n/gm, '')
  src = src.replace(
    /^\s*if \(!session\?\.\w+\)[^\n]*\n/gm, '')

  // Re-point identity reads at the verified context.
  src = src.replace(/\(session\.user as any\)\.id/g, 'ctx.adminId')
  src = src.replace(/\(session\.user as any\)\.email/g, 'ctx.email')
  src = src.replace(/\(session\.user as any\)\.role/g, 'ctx.role')
  src = src.replace(/\(session!\.user as any\)\.id/g, 'ctx.adminId')
  src = src.replace(/\(session!\.user as any\)\.email/g, 'ctx.email')
  src = src.replace(/session\?\.user\?\.email/g, 'ctx.email')

  // Stop leaking internal error text to clients (withAdmin logs it instead).
  src = src.replace(/^\s*detail: String\(error\)[^\n]*\n/gm, '')
  src = src.replace(/^\s*detail: error instanceof Error[^\n]*\n/gm, '')

  // Imports: add withAdmin, drop what is now unused.
  if (!src.includes("from '@/lib/with-admin'")) {
    src = src.replace(
      /^(import .+\n)(?![\s\S]*^import )/m,
      `$1import { withAdmin } from '@/lib/with-admin'\n`,
    )
  }
  if (!/getServerSession\s*\(/.test(src.replace(/^import .+$/gm, ''))) {
    src = src.replace(/^import \{ getServerSession \} from 'next-auth'\n/m, '')
    if (!/authOptions/.test(src.replace(/^import .+$/gm, ''))) {
      src = src.replace(/^import \{ authOptions \} from '@\/lib\/auth'\n/m, '')
    }
  }

  if (!DRY) writeFileSync(file, src)
  migrated++
  report.push(`${key} (${edits.length} handler${edits.length > 1 ? 's' : ''})`)
}

console.log(`${DRY ? '[dry] ' : ''}migrated ${migrated}, skipped ${skipped}`)
for (const r of report) console.log('  ' + r)
