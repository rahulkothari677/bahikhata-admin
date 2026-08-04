import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { assertSafeWebhookUrl, isPrivateAddress } from '../src/lib/webhook-url-guard'

/**
 * A webhook must never be able to point at an internal address.
 *
 * WHY (audit 2026-08-04, Phase 7). The SSRF guard existed and was thorough —
 * protocol, port, literal denylist, DNS resolution of every returned address.
 * It ran in exactly ONE of the three places that could reach a webhook URL.
 *
 *   POST   /api/admin/webhooks       full guard
 *   PATCH  /api/admin/webhooks/[id]  `new URL(url)` — syntax only
 *   delivery (webhook-engine.ts)     no check; fetched endpoint.url directly
 *
 * So the guard was a formality:
 *
 *   1. create a webhook at https://example.com                   → passes
 *   2. PATCH the url to http://169.254.169.254/latest/meta-data/ → passed
 *   3. wait for the 5-minute delivery cron
 *
 * 169.254.169.254 is the cloud instance metadata service; on most providers it
 * returns IAM credentials. And webhook-engine stores the first 1KB of every
 * response in `webhookDelivery.responseBody`, which the deliveries API returns
 * — so this was not blind SSRF. It was a full read primitive that turned an
 * admin-panel compromise into a cloud-account compromise.
 *
 * The guard now lives in one file and is called by all three paths, including
 * immediately before the fetch — the one place that cannot be routed around.
 *
 * DNS is disabled in these tests (resolveDns: false) so they assert the
 * synchronous rules without network flakiness; the delivery-time call in
 * production leaves resolution on.
 */

const ROOT = path.resolve(__dirname, '..', 'src')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

describe('the URL that caused this audit', () => {
  it('rejects the cloud metadata endpoint', async () => {
    const v = await assertSafeWebhookUrl('http://169.254.169.254/latest/meta-data/', { resolveDns: false })
    expect(v.ok).toBe(false)
  })
})

describe('private and internal destinations are refused', () => {
  it.each([
    ['loopback by name', 'http://localhost/hook'],
    ['loopback by IP', 'http://127.0.0.1/hook'],
    ['all-zeros', 'http://0.0.0.0/hook'],
    ['IPv6 loopback', 'http://[::1]/hook'],
    ['link-local / metadata', 'http://169.254.169.254/'],
    ['private 10/8', 'http://10.1.2.3/hook'],
    ['private 192.168/16', 'http://192.168.1.1/hook'],
    ['private 172.16/12 low', 'http://172.16.0.1/hook'],
    ['private 172.16/12 high', 'http://172.31.255.254/hook'],
    ['decimal-encoded 127.0.0.1', 'http://2130706433/hook'],
  ])('refuses %s', async (_label, url) => {
    expect((await assertSafeWebhookUrl(url, { resolveDns: false })).ok).toBe(false)
  })

  it('refuses non-http protocols', async () => {
    for (const u of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/']) {
      expect((await assertSafeWebhookUrl(u, { resolveDns: false })).ok).toBe(false)
    }
  })

  it('refuses non-standard ports — internal services rarely sit on 80/443', async () => {
    expect((await assertSafeWebhookUrl('http://example.com:8080/hook', { resolveDns: false })).ok).toBe(false)
    expect((await assertSafeWebhookUrl('http://example.com:6379/', { resolveDns: false })).ok).toBe(false)
  })

  it('refuses empty, null, undefined and non-string input rather than throwing', async () => {
    for (const value of ['', '   ', null, undefined, 42, {}, []] as unknown[]) {
      expect((await assertSafeWebhookUrl(value, { resolveDns: false })).ok).toBe(false)
    }
  })
})

describe('legitimate destinations still work', () => {
  // The control. A guard that blocks everything is not a fix.
  it.each([
    'https://example.com/webhooks/ekbook',
    'https://hooks.slack.com/services/T000/B000/xxxx',
    'http://partner.example.co.in/hook',
    'https://example.com:443/hook',
  ])('allows %s', async (url) => {
    expect((await assertSafeWebhookUrl(url, { resolveDns: false })).ok).toBe(true)
  })
})

describe('isPrivateAddress', () => {
  it('unwraps IPv4-mapped IPv6, a classic bypass', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true)
  })

  it('covers the whole 172.16/12 block and nothing outside it', () => {
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.255')).toBe(true)
    // 172.15 and 172.32 are PUBLIC — a prefix-string check gets these wrong.
    expect(isPrivateAddress('172.15.0.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
  })

  it('treats ordinary public addresses as public', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
  })
})

describe('every path that can set or use a webhook URL calls the guard', () => {
  // This is the actual regression. The rules above were already right; what
  // was missing was calling them.
  it.each([
    ['create', 'app/api/admin/webhooks/route.ts'],
    ['update', 'app/api/admin/webhooks/[id]/route.ts'],
    ['delivery', 'lib/webhook-engine.ts'],
  ])('%s calls assertSafeWebhookUrl', (_label, file) => {
    expect(read(file)).toMatch(/assertSafeWebhookUrl\(/)
  })

  it('delivery checks BEFORE it fetches, not after', () => {
    const src = read('lib/webhook-engine.ts')
    const guard = src.indexOf('await assertSafeWebhookUrl(delivery.endpoint.url)')
    const fetchCall = src.indexOf('await fetch(delivery.endpoint.url')
    expect(guard).toBeGreaterThan(-1)
    expect(fetchCall).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(fetchCall)
  })

  it('a refused delivery is not retried — a private address stays private', () => {
    const src = read('lib/webhook-engine.ts')
    const block = src.slice(src.indexOf('Refused to deliver'))
    expect(block.slice(0, 900)).toMatch(/nextRetryAt: null/)
  })
})
