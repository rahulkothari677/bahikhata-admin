/**
 * SSRF guard for webhook destinations.
 *
 * 🔒 Extracted 2026-08-04 (Phase 7 audit) because it was enforced in exactly
 * one of the three places that need it.
 *
 * POST /api/admin/webhooks ran the full check: protocol, port, a literal
 * denylist, and a DNS lookup of every resolved address. Thorough.
 *
 * PATCH /api/admin/webhooks/[id] ran `new URL(url)` — a SYNTAX check — and
 * nothing else. So the guard was a formality:
 *
 *   1. create a webhook pointing at https://example.com          → passes
 *   2. PATCH the url to http://169.254.169.254/latest/meta-data/ → passes
 *   3. wait for the 5-minute delivery cron
 *
 * and webhook-engine.ts fetched it without re-checking. That endpoint is the
 * cloud instance metadata service; on most providers it hands back IAM
 * credentials. Worse, the engine stores the first 1KB of every response in
 * `webhookDelivery.responseBody`, which is readable through the deliveries
 * API — so this was not blind SSRF. It was a full read primitive that turned
 * an admin-panel compromise into a cloud-account compromise.
 *
 * The rule this file exists to enforce: validation that lives on one code path
 * is not validation. Any path that can set or use a webhook URL calls this.
 */

/** Literal hosts and prefixes that never need a DNS round-trip to reject. */
const BLOCKED_LITERALS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '169.254.', '10.', '192.168.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.',
  '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  'fc00:', 'fd00:', 'fe80:',
]

/** Private, loopback and link-local ranges, checked against RESOLVED addresses. */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^::ffff:/, '') // unwrap IPv4-mapped IPv6
  return (
    a === '127.0.0.1' || a === '::1' || a === '0.0.0.0' ||
    a.startsWith('127.') ||
    a.startsWith('10.') ||
    a.startsWith('192.168.') ||
    a.startsWith('169.254.') ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(a) ||
    a.startsWith('fc00:') || a.startsWith('fd00:') || a.startsWith('fe80:')
  )
}

export interface UrlVerdict {
  ok: boolean
  /** Safe to show a user — never contains anything they did not already send. */
  error?: string
  detail?: string
}

/**
 * Full check: syntax, protocol, port, literal denylist, and DNS resolution.
 *
 * `resolveDns: false` skips the lookup for the fast synchronous cases (and for
 * unit tests). The DNS step is what catches a public hostname whose A-record
 * points somewhere private, so production paths should leave it on.
 */
export async function assertSafeWebhookUrl(
  raw: unknown,
  opts: { resolveDns?: boolean } = {},
): Promise<UrlVerdict> {
  const resolveDns = opts.resolveDns !== false

  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Webhook URL is required' }
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Webhook URL must use http or https protocol' }
  }

  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  if (port !== '80' && port !== '443') {
    return { ok: false, error: 'Webhook URL must use standard ports (80 or 443)' }
  }

  /*
   * Strip the brackets an IPv6 host carries in a URL. `new URL('http://[::1]/')`
   * gives hostname `"[::1]"`, so a denylist entry of `'::1'` never matched it —
   * the original inline check had this hole too, and `http://[::1]/hook` sailed
   * through every literal comparison.
   */
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (BLOCKED_LITERALS.some(p => hostname === p || hostname.startsWith(p))) {
    return { ok: false, error: 'Webhook URL must not point to a private or internal address' }
  }
  // Decimal/octal/hex encodings of an IP (http://2130706433/ is 127.0.0.1).
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/.test(hostname)) {
    return { ok: false, error: 'Webhook URL must not use a numeric host encoding' }
  }

  if (!resolveDns) return { ok: true }

  const dns = await import('dns')
    .then(m => m.promises || (m as any).default?.promises)
    .catch(() => null)

  if (dns?.lookup) {
    try {
      const addresses = await dns.lookup(hostname, { all: true })
      for (const { address } of addresses) {
        if (isPrivateAddress(address)) {
          return {
            ok: false,
            error: 'Webhook URL resolves to a private or internal address',
            detail: `Hostname ${hostname} resolves to ${address}, which is in a private range.`,
          }
        }
      }
    } catch {
      /*
       * Resolution failed — the hostname may simply not exist yet. Allowing it
       * here is safe ONLY because delivery re-checks: webhook-engine.ts calls
       * this again immediately before every fetch, so a name that resolves
       * somewhere private later is caught at the moment it matters. Without
       * that second call this branch would be the bypass.
       */
    }
  }

  return { ok: true }
}
