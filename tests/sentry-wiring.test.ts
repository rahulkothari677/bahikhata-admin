import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Guards that Sentry is actually WIRED, not merely configured.
 *
 * WHY (audit 2026-07-28): two separate failures, both silent.
 *
 * 1. The admin panel had no Sentry at all, while global-error-boundary.tsx
 *    carried the comment "(in production, this goes to Sentry)". Crashes went
 *    to a console nobody watched.
 *
 * 2. Then, having installed it, the browser side STILL did not run: Next 15.3+
 *    stopped auto-loading `sentry.client.config.ts`. The file existed and
 *    looked right; it was never executed. Confirmed against the deployed app —
 *    no SDK on the page, no DSN in the bundle.
 *
 * The same gap exists in bahikhata-pro, where a test reads
 * sentry.client.config.ts AS TEXT and asserts its contents. It passes while
 * the file never runs — a config file validated by a test that cannot tell
 * whether anything loads it.
 *
 * So these assertions check the WIRING (is the config imported from a hook
 * Next actually calls?), not the contents.
 */

const ROOT = join(__dirname, '..')

describe('Sentry is loaded, not just configured', () => {
  it('has a server instrumentation hook that imports the server config', () => {
    const hook = join(ROOT, 'src', 'instrumentation.ts')
    expect(existsSync(hook), 'src/instrumentation.ts must exist').toBe(true)
    expect(readFileSync(hook, 'utf8')).toMatch(/sentry\.server\.config/)
  })

  it('has a CLIENT instrumentation hook that imports the client config', () => {
    // THE bug. Next 15.3+ requires instrumentation-client.ts; without it the
    // browser config is dead code that reviews cleanly.
    const hook = join(ROOT, 'src', 'instrumentation-client.ts')
    expect(
      existsSync(hook),
      'src/instrumentation-client.ts must exist — Next 16 does NOT auto-load sentry.client.config.ts',
    ).toBe(true)
    expect(readFileSync(hook, 'utf8')).toMatch(/sentry\.client\.config/)
  })

  it('the error boundary reports to Sentry rather than only logging', () => {
    const src = readFileSync(
      join(ROOT, 'src', 'components', 'admin', 'global-error-boundary.tsx'),
      'utf8',
    )
    expect(src).toMatch(/Sentry\.captureException/)
  })

  it('does NOT enable session replay in the admin panel', () => {
    // A replay of an admin session is a recording of a shopkeeper's books and
    // their customers' names, streamed to a third party. Even masked, that is a
    // data-transfer decision needing its own lawful basis and a DPIA — not a
    // debugging convenience. The main app may use it; this panel must not.
    const client = readFileSync(join(ROOT, 'sentry.client.config.ts'), 'utf8')
    expect(client).not.toMatch(/replayIntegration|Replay\(/)
    expect(client).not.toMatch(/replaysSessionSampleRate:\s*[^0]/)
  })

  it('scrubs identifiers before anything leaves the building', () => {
    // Prisma validation errors embed the field values that failed. Shipping a
    // shopkeeper's phone number or their customer's name to a third party
    // would be an unlawful disclosure, so this is a compliance control.
    const server = readFileSync(join(ROOT, 'sentry.server.config.ts'), 'utf8')
    expect(server).toMatch(/beforeSend/)
    for (const key of ['phone', 'gstin', 'email', 'name', 'token', 'secret']) {
      expect(server, `beforeSend must scrub "${key}"`).toMatch(new RegExp(key))
    }
    // Query strings on admin routes routinely contain a person's name.
    expect(server).toMatch(/query_string/)
  })
})
