import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { readApiError } from '../src/lib/read-api-error'

/**
 * Guards for API error rendering in the admin UI.
 *
 * WHY (audit 2026-07-27): withAdmin() standardised error responses to
 * `{ error: { code, message, requestId } }`. That is the right shape. But 46
 * call sites across 22 pages were written against the old bare-string form:
 *
 *     throw new Error(data.error || `HTTP ${r.status}`)
 *
 * `data.error` became an OBJECT, and `new Error(object)` stringifies to
 * "[object Object]". So the moment the routes were migrated, EVERY error toast
 * in the admin panel started reading "[object Object]".
 *
 * Nothing caught it. tsc cannot: these responses are untyped through fetch().
 * The tests could not: nothing rendered an error path. It was a regression
 * introduced by the migration itself, and it would have been found by an
 * operator hitting a validation error in production.
 */

describe('readApiError', () => {
  it('reads the structured shape withAdmin returns', () => {
    const msg = readApiError({
      error: { code: 'FORBIDDEN', message: 'Your role (viewer) cannot perform this action.' },
    })
    expect(msg).toContain('viewer')
    expect(msg).not.toContain('[object Object]')
  })

  it('appends a short requestId so an operator can quote it', () => {
    // "it failed" vs "it failed, ref 8f3a1b2c" is the difference between
    // guessing and grepping the logs.
    const msg = readApiError({
      error: { message: 'Something went wrong.', requestId: '8f3a1b2c-dead-beef-0000-111122223333' },
    })
    expect(msg).toContain('8f3a1b2c')
    expect(msg).not.toContain('dead-beef')
  })

  it('still reads the legacy bare-string shape', () => {
    // The deliberately-public routes (login-probe, setup, forgot-password) are
    // not wrapped and still return a string.
    expect(readApiError({ error: 'Invalid email or password' })).toBe('Invalid email or password')
  })

  it('falls back to the code when there is no message', () => {
    expect(readApiError({ error: { code: 'RATE_LIMITED' } })).toBe('RATE_LIMITED')
  })

  it('never returns "[object Object]" for any input', () => {
    // The actual bug, stated directly.
    const inputs: unknown[] = [
      { error: { code: 'X', message: 'Y' } },
      { error: 'plain' },
      { error: {} },
      { error: null },
      {},
      null,
      undefined,
      { message: 'top-level message' },
    ]
    for (const i of inputs) {
      expect(readApiError(i, 500)).not.toContain('[object Object]')
      expect(readApiError(i, 500).length).toBeGreaterThan(0)
    }
  })

  it('includes the HTTP status when the body says nothing useful', () => {
    expect(readApiError({}, 503)).toContain('503')
    expect(readApiError(null, 502)).toContain('502')
  })
})

describe('no page reads .error as a bare string', () => {
  function findTsx(dir: string, out: string[] = []): string[] {
    if (!statSync(dir, { throwIfNoEntry: false })) return out
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) findTsx(full, out)
      else if (e.endsWith('.tsx')) out.push(full)
    }
    return out
  }

  const files = [
    ...findTsx(join(__dirname, '..', 'src', 'app', '(admin)')),
    ...findTsx(join(__dirname, '..', 'src', 'components')),
  ]

  it('finds the pages (guards against a broken walker)', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('no `new Error(data.error)` remains — it renders [object Object]', () => {
    const offenders = files.filter((f) =>
      /new Error\(\s*\w+\.error\b/.test(readFileSync(f, 'utf8')),
    )
    expect(
      offenders.map((f) => f.split(/[\\/]/).slice(-2).join('/')),
      'Use readApiError(data, status). withAdmin returns an object, not a string.',
    ).toEqual([])
  })
})
