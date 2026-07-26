import { describe, it, expect } from 'vitest'
import { maskEmail, maskName, maskPhone, maskGstin, pseudonym } from '../src/lib/pii'

/**
 * Guards for PII masking.
 *
 * WHY (audit 2026-07-26): /api/admin/activity streamed every shopkeeper's
 * sales and purchases into the admin UI attributed by name and email. Masking
 * is now the default for identifiers on admin surfaces; unmasking is an
 * explicit, reason-logged action.
 *
 * The critical property is that masking is LOSSY and NOT REVERSIBLE. A previous
 * bug in the main app used truncated btoa() as an email "hash" — which is just
 * base64, and trivially decoded. These tests exist to stop that recurring.
 */
describe('maskEmail', () => {
  it('hides the local part and the domain name, keeps the TLD', () => {
    expect(maskEmail('ram@kirana.com')).toBe('r••@k•••••.com')
  })

  it('does not leak the original anywhere in the output', () => {
    const masked = maskEmail('ramesh.kumar@bigshop.co.in')!
    expect(masked).not.toContain('amesh')
    expect(masked).not.toContain('igshop')
  })

  it('is not reversible by base64 or any encoding', () => {
    const masked = maskEmail('ram@kirana.com')!
    // A masked value must not decode back to anything resembling the input.
    expect(() => Buffer.from(masked, 'base64').toString('utf8')).not.toThrow()
    expect(Buffer.from(masked, 'base64').toString('utf8')).not.toContain('ram')
  })

  it('handles null, undefined and malformed input without throwing', () => {
    expect(maskEmail(null)).toBeNull()
    expect(maskEmail(undefined)).toBeNull()
    expect(maskEmail('notanemail')).toBe('•••')
    expect(maskEmail('')).toBeNull()
  })
})

describe('maskName', () => {
  it('keeps only initials', () => {
    expect(maskName('Ramesh Kumar')).toBe('R••••• K••••')
  })

  it('handles a single name and extra whitespace', () => {
    expect(maskName('Ramesh')).toBe('R•••••')
    expect(maskName('  Ramesh   Kumar  ')).toBe('R••••• K••••')
  })

  it('returns null for empty input', () => {
    expect(maskName(null)).toBeNull()
    expect(maskName('')).toBeNull()
  })
})

describe('maskPhone', () => {
  it('keeps first two and last two digits so support can confirm identity', () => {
    expect(maskPhone('9876543210')).toBe('98••••••10')
  })

  it('strips formatting before masking', () => {
    expect(maskPhone('+91 98765-43210')).toBe('91••••••••10')
  })

  it('never returns more than 4 real digits', () => {
    const masked = maskPhone('9876543210')!
    const realDigits = masked.replace(/•/g, '')
    expect(realDigits.length).toBeLessThanOrEqual(4)
  })
})

describe('maskGstin', () => {
  it('keeps the state code and check digit only', () => {
    expect(maskGstin('27AAPFU0939F1ZV')).toBe('27•••••••••••ZV')
  })

  it('does not leak the embedded PAN', () => {
    // A GSTIN contains the holder's PAN in positions 3-12. That must not survive.
    expect(maskGstin('27AAPFU0939F1ZV')).not.toContain('AAPFU0939F')
  })
})

describe('pseudonym', () => {
  it('is stable for the same user', () => {
    expect(pseudonym('user_abc123')).toBe(pseudonym('user_abc123'))
  })

  it('differs between users', () => {
    expect(pseudonym('user_abc123')).not.toBe(pseudonym('user_xyz789'))
  })

  it('does not contain the original id', () => {
    expect(pseudonym('cms23t2b20000g5i4bff0zrq5')).not.toContain('cms23t2b2')
  })
})
