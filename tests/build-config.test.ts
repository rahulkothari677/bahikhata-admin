import { describe, it, expect } from 'vitest'
import nextConfig from '../next.config'

/**
 * Guard: the build must never again suppress type or lint errors.
 *
 * WHY this test exists (audit 2026-07-26):
 * next.config.ts carried `typescript: { ignoreBuildErrors: true }` and
 * `eslint: { ignoreDuringBuilds: true }`. They were justified in a comment as
 * "pre-existing withTimeout type inference issues". That was wrong: 476 of the
 * 481 errors were a stale generated Prisma client. The 5 real errors it hid
 * included four routes selecting a `partner` relation that had been deleted
 * from the schema — which, combined with `.catch(() => [])`, made the API Keys
 * and Webhooks pages render empty forever instead of failing loudly.
 *
 * This asserts the imported config OBJECT, not the file's text, so it cannot
 * be defeated by reformatting or by moving the flag behind a variable.
 */
describe('next.config.ts', () => {
  it('does not suppress TypeScript build errors', () => {
    expect(nextConfig.typescript?.ignoreBuildErrors).toBeFalsy()
  })

  it('does not suppress ESLint during builds', () => {
    // `eslint` is not even a valid NextConfig key in Next 16; assert absence.
    expect((nextConfig as Record<string, unknown>).eslint).toBeUndefined()
  })

  it('does not expose source maps in production', () => {
    expect(nextConfig.productionBrowserSourceMaps).toBe(false)
  })

  it('sets a Content-Security-Policy with frame-ancestors none', async () => {
    const headers = await nextConfig.headers?.()
    const csp = headers?.[0]?.headers?.find(
      (h) => h.key === 'Content-Security-Policy',
    )
    expect(csp).toBeDefined()
    expect(csp!.value).toContain("frame-ancestors 'none'")
    expect(csp!.value).toContain("object-src 'none'")
  })
})
