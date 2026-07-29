import { describe, it, expect } from 'vitest'
import {
  istParts,
  isWithinPromotionalWindow,
  normaliseCategory,
  checkSendAllowed,
  partitionByConsent,
  ensureStopInstruction,
} from '../src/lib/comms-compliance'

/**
 * WHY (audit 2026-07-28, §B6): the notification send path had no compliance
 * checks at all. A promotional SMS blast at 2am, to users who never opted in,
 * on an unregistered DLT template, was three clicks away in the admin panel.
 *
 * The timezone tests matter more than they look. Vercel runs in UTC and a
 * laptop does not, so any check reading the server's local clock passes in
 * development and fails in production — silently, by sending at the wrong hour.
 */

/** An instant expressed in IST, converted to the UTC epoch. IST = UTC+5:30. */
const atIST = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 6, 28, hour, minute) - (5 * 60 + 30) * 60_000)

describe('IST is computed from the epoch, never from the server clock', () => {
  it('reads the right hour regardless of where the process runs', () => {
    // 09:30 UTC is 15:00 IST.
    expect(istParts(new Date('2026-07-28T09:30:00Z'))).toEqual({ hour: 15, minute: 0 })
  })

  it('handles the half-hour offset', () => {
    // 18:45 UTC + 5:30 = 00:15 IST the next day.
    expect(istParts(new Date('2026-07-28T18:45:00Z'))).toEqual({ hour: 0, minute: 15 })
  })

  it('handles the midnight rollover', () => {
    // 20:00 UTC = 01:30 IST next day — the case a naive UTC check gets wrong.
    expect(istParts(new Date('2026-07-28T20:00:00Z'))).toEqual({ hour: 1, minute: 30 })
  })
})

describe('the promotional window is 10:00–21:00 IST', () => {
  it('allows the boundary at 10:00 and blocks the boundary at 21:00', () => {
    expect(isWithinPromotionalWindow(atIST(10, 0))).toBe(true)
    expect(isWithinPromotionalWindow(atIST(20, 59))).toBe(true)
    expect(isWithinPromotionalWindow(atIST(21, 0))).toBe(false)
    expect(isWithinPromotionalWindow(atIST(9, 59))).toBe(false)
  })

  it('blocks the 2am blast', () => {
    expect(isWithinPromotionalWindow(atIST(2, 0))).toBe(false)
  })
})

describe('category normalisation decides what is regulated', () => {
  it('treats marketing as promotional', () => {
    expect(normaliseCategory('promotional')).toBe('promotional')
    expect(normaliseCategory('Marketing')).toBe('promotional')
  })

  it('treats account-related categories as service, not marketing', () => {
    // These are messages about the user's own activity — contract performance.
    for (const c of ['general', 'payment', 'onboarding', 'churn']) {
      expect(normaliseCategory(c)).toBe('service')
    }
  })

  it('defaults an unknown or missing category to service, never promotional', () => {
    // Failing the other way would silently gate password resets.
    expect(normaliseCategory(null)).toBe('service')
    expect(normaliseCategory('something_new')).toBe('service')
  })
})

describe('transactional messages are never blocked', () => {
  it('sends a payment receipt at 3am with no DLT id', () => {
    // Gating these would break password resets and receipts — and would get
    // the whole compliance layer ripped out by whoever is on call.
    const refusal = checkSendAllowed(
      { category: 'transactional', channel: 'sms' },
      atIST(3, 0),
    )
    expect(refusal).toBeNull()
  })

  it('sends a service message at 3am', () => {
    expect(checkSendAllowed({ category: 'payment', channel: 'sms' }, atIST(3, 0))).toBeNull()
  })
})

describe('promotional SMS requires DLT registration', () => {
  const inWindow = atIST(11, 0)
  const approved = {
    category: 'promotional' as const,
    channel: 'sms',
    dltTemplateId: '1107xxxxxxxxxxxx',
    dltHeaderId: 'EKBOOK',
    approvalStatus: 'approved',
  }

  it('allows a fully registered, approved template inside the window', () => {
    expect(checkSendAllowed(approved, inWindow)).toBeNull()
  })

  it('refuses without a DLT template id, and says how to fix it', () => {
    const r = checkSendAllowed({ ...approved, dltTemplateId: null }, inWindow)
    expect(r?.code).toBe('DLT_TEMPLATE_MISSING')
    // A refusal with no remedy gets worked around instead of fixed.
    expect(r?.remedy).toMatch(/DLT portal/i)
  })

  it('refuses on a blank-but-present template id', () => {
    expect(checkSendAllowed({ ...approved, dltTemplateId: '   ' }, inWindow)?.code)
      .toBe('DLT_TEMPLATE_MISSING')
  })

  it('refuses without a registered header', () => {
    expect(checkSendAllowed({ ...approved, dltHeaderId: null }, inWindow)?.code)
      .toBe('DLT_HEADER_MISSING')
  })

  it('refuses a template that is not marked approved', () => {
    expect(checkSendAllowed({ ...approved, approvalStatus: 'pending' }, inWindow)?.code)
      .toBe('TEMPLATE_NOT_APPROVED')
  })

  it('refuses outside the window even when fully registered', () => {
    const r = checkSendAllowed(approved, atIST(22, 30))
    expect(r?.code).toBe('OUTSIDE_PROMOTIONAL_WINDOW')
    // The message must state the actual IST time, or nobody believes it.
    expect(r?.message).toContain('22:30 IST')
  })
})

describe('DLT does not apply to WhatsApp or email', () => {
  // Requiring a DLT id on these would be a check that cannot be satisfied —
  // WhatsApp is governed by Meta's policy via a BSP, not TRAI.
  it('does not demand a DLT id for promotional whatsapp', () => {
    expect(checkSendAllowed({ category: 'promotional', channel: 'whatsapp' }, atIST(11)))
      .toBeNull()
  })

  it('does not demand a DLT id for promotional email', () => {
    expect(checkSendAllowed({ category: 'promotional', channel: 'email' }, atIST(11)))
      .toBeNull()
  })

  it('still applies the time window to them', () => {
    expect(checkSendAllowed({ category: 'promotional', channel: 'email' }, atIST(23))?.code)
      .toBe('OUTSIDE_PROMOTIONAL_WINDOW')
  })
})

describe('consent: silence is not opt-in', () => {
  const users = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]

  it('blocks promotional to everyone with no preference on record', () => {
    const { allowed, blocked } = partitionByConsent(users, 'promotional', 'sms', [])
    expect(allowed).toEqual([])
    expect(blocked).toHaveLength(3)
    expect(blocked[0].reason).toMatch(/opt-in/)
  })

  it('allows only those who positively opted in, on that channel', () => {
    const { allowed, blocked } = partitionByConsent(users, 'promotional', 'sms', [
      { userId: 'u1', channel: 'sms', category: 'promotional', optedIn: true },
      { userId: 'u2', channel: 'email', category: 'promotional', optedIn: true }, // wrong channel
      { userId: 'u3', channel: 'sms', category: 'promotional', optedIn: false },  // withdrawn
    ])
    expect(allowed.map(a => a.userId)).toEqual(['u1'])
    expect(blocked.map(b => b.userId)).toEqual(['u2', 'u3'])
  })

  it('does NOT filter transactional messages by marketing consent', () => {
    // Someone who opted out of marketing must still get their payment receipt.
    const { allowed } = partitionByConsent(users, 'transactional', 'sms', [])
    expect(allowed).toHaveLength(3)
  })
})

describe('every promotional SMS carries a way out', () => {
  it('appends the STOP instruction when the template forgot it', () => {
    expect(ensureStopInstruction('Big sale today!', 'promotional', 'sms'))
      .toContain('Reply STOP to opt out.')
  })

  it('does not duplicate one that is already there', () => {
    const body = 'Big sale! Reply STOP to unsubscribe.'
    expect(ensureStopInstruction(body, 'promotional', 'sms')).toBe(body)
  })

  it('leaves transactional messages alone', () => {
    expect(ensureStopInstruction('Your payment of Rs 500 was received.', 'transactional', 'sms'))
      .toBe('Your payment of Rs 500 was received.')
  })
})
