import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { partitionByConsent } from '../src/lib/comms-compliance'

/**
 * Campaigns must respect promotional consent, like one-off sends already do.
 *
 * WHY (audit 2026-08-04, Phase 7). POST /api/admin/notifications/send partitions
 * recipients by CommunicationPreference and refuses when nobody has opted in.
 * POST /api/admin/campaigns/[id]/action — which sends the same messages through
 * the same sendNotification() — did not consult consent at all. It looped over
 * every user with an address and sent.
 *
 * The wrong way round: a campaign is the PROMOTIONAL path by definition
 * (scheduled marketing to a segment), so the route that most needed the check
 * was the one without it, while the one-off admin send that is usually service
 * email had it.
 *
 * Under DPDP and the TRAI commercial-communication rules, the absence of a
 * preference row means NO consent — silence is not opt-in. That reading is
 * already encoded in partitionByConsent and in the CommunicationPreference
 * model's own comment.
 */

const ROUTE = path.resolve(__dirname, '../src/app/api/admin/campaigns/[id]/action/route.ts')
const src = fs.readFileSync(ROUTE, 'utf8').replace(/\r\n/g, '\n')

describe('the campaign send path consults consent', () => {
  it('uses the shared helper, not a second implementation of the rule', () => {
    expect(src).toMatch(/partitionByConsent\(/)
    expect(src).toMatch(/from '@\/lib\/comms-compliance'/)
  })

  it('reads the recipients\' preferences', () => {
    expect(src).toMatch(/communicationPreference\.findMany/)
  })

  it('decides by the template\'s category rather than assuming', () => {
    expect(src).toMatch(/normaliseCategory\(template\.category\)/)
  })

  it('filters BEFORE the send loop, not after', () => {
    const filterAt = src.indexOf('partitionByConsent(')
    const sendAt = src.indexOf('await sendNotification(')
    expect(filterAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(-1)
    expect(filterAt).toBeLessThan(sendAt)
  })

  it('records who was skipped', () => {
    // "We did not message 400 people and cannot say why" is the state this
    // exists to prevent.
    expect(src).toMatch(/campaign_consent_filtered/)
  })
})

describe('the recipients carry the field the helper matches on', () => {
  /*
   * This is the trap I nearly shipped. partitionByConsent matches on `userId`;
   * the user rows carry `id`. A cast makes the compiler happy while `r.userId`
   * is undefined at runtime, so no recipient ever matches an opt-in and EVERY
   * promotional campaign silently sends to nobody — a failure indistinguishable
   * from "nobody has opted in".
   */
  it('attaches userId explicitly instead of casting', () => {
    expect(src).toMatch(/userId: u\.id/)
    expect(src).not.toMatch(/as Array<\{ id: string; userId: string \}/)
  })

  it('proves the trap is real: rows without userId are all blocked', () => {
    const rows = [{ id: 'u1' }, { id: 'u2' }] as unknown as Array<{ userId: string }>
    const prefs = [
      { userId: 'u1', channel: 'email', category: 'promotional', optedIn: true },
      { userId: 'u2', channel: 'email', category: 'promotional', optedIn: true },
    ]
    const { allowed } = partitionByConsent(rows, 'promotional', 'email', prefs)
    // Both users HAVE opted in, yet none is allowed — because the match field
    // is missing. Silent, total, and it type-checks.
    expect(allowed).toHaveLength(0)
  })

  it('and that mapping userId fixes it', () => {
    const rows = [{ id: 'u1' }, { id: 'u2' }].map(u => ({ ...u, userId: u.id }))
    const prefs = [
      { userId: 'u1', channel: 'email', category: 'promotional', optedIn: true },
      { userId: 'u2', channel: 'email', category: 'promotional', optedIn: false },
    ]
    const { allowed, blocked } = partitionByConsent(rows, 'promotional', 'email', prefs)
    expect(allowed.map(a => a.userId)).toEqual(['u1'])
    expect(blocked.map(b => b.userId)).toEqual(['u2'])
  })
})

describe('non-promotional messages are not gated', () => {
  // Control. A receipt is not marketing; gating service mail would break
  // things users need, and would be its own defect.
  it.each(['transactional', 'service'] as const)('%s passes everyone through', (category) => {
    const rows = [{ userId: 'u1' }, { userId: 'u2' }]
    const { allowed, blocked } = partitionByConsent(rows, category, 'email', [])
    expect(allowed).toHaveLength(2)
    expect(blocked).toHaveLength(0)
  })

  it('an absent preference row still blocks promotional — silence is not opt-in', () => {
    const rows = [{ userId: 'u1' }]
    const { allowed, blocked } = partitionByConsent(rows, 'promotional', 'email', [])
    expect(allowed).toHaveLength(0)
    expect(blocked[0].reason).toMatch(/no promotional opt-in/)
  })
})
