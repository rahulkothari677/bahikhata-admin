import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * A handler that returns a 5xx must say why, somewhere.
 *
 * WHY (audit 2026-08-04, Phase 7). Deleting a webhook endpoint failed in
 * production with a flat 500. The cause could not be determined from anywhere:
 * its catch block discarded the error entirely — no console.error, unlike the
 * PATCH handler thirty lines above it. Nothing in the response, nothing in the
 * logs.
 *
 * withAdmin logs when a handler THROWS, but these blocks catch first, so the
 * wrapper never sees them. A sweep found 19 of them.
 *
 * An error handler that drops its error turns a fixable bug into an unfixable
 * one. It is a small omission that costs whole debugging sessions, and it is
 * invisible in review because the code looks tidy — the failure is what is
 * ABSENT.
 *
 * This test scans for the shape rather than listing the files, so a new route
 * cannot reintroduce it.
 */

const API_ROOT = path.resolve(__dirname, '../src/app/api')

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) routeFiles(p, out)
    else if (e.name === 'route.ts') out.push(p)
  }
  return out
}

interface Offender { route: string; line: number }

function findSilentCatches(): Offender[] {
  const offenders: Offender[] = []

  for (const file of routeFiles(API_ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
    const route = path
      .relative(API_ROOT, file)
      .split(path.sep)
      .join('/')
      .replace('/route.ts', '')

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)\} catch \((\w+)\) \{\s*$/)
      if (!m) continue

      // Read the catch body up to the closing brace at the same indent.
      const indent = m[1]
      const body: string[] = []
      for (let j = i + 1; j < lines.length && lines[j] !== `${indent}}`; j++) body.push(lines[j])
      const text = body.join('\n')

      // Only handlers that answer with a server error. A catch that recovers,
      // returns a 4xx, or rethrows is a different thing and not this rule.
      if (!/status:\s*5\d\d/.test(text)) continue
      if (/console\.(error|warn)|logAdminAction|ctx\.audit|throw/.test(text)) continue

      offenders.push({ route, line: i + 1 })
    }
  }
  return offenders
}

describe('no route returns a 5xx while discarding its error', () => {
  it('scans a realistic number of routes — a zero here would make this vacuous', () => {
    expect(routeFiles(API_ROOT).length).toBeGreaterThan(70)
  })

  it('finds no silent 5xx handler', () => {
    const offenders = findSilentCatches()
    expect(offenders.map(o => `${o.route}:${o.line}`)).toEqual([])
  })

  it('the detector actually detects — proven on a synthetic offender', () => {
    /*
     * The scanner above is only worth having if it can fire. Rather than
     * trusting an empty result, check the predicate itself against a block
     * that should trip it and one that should not.
     */
    const silent = ['    return NextResponse.json({ error: 1 }, { status: 500 })']
    const logged = [
      "    console.error('[x] failed:', error)",
      '    return NextResponse.json({ error: 1 }, { status: 500 })',
    ]
    const trips = (body: string[]) => {
      const text = body.join('\n')
      return /status:\s*5\d\d/.test(text) && !/console\.(error|warn)|logAdminAction|ctx\.audit|throw/.test(text)
    }
    expect(trips(silent)).toBe(true)
    expect(trips(logged)).toBe(false)
  })
})
