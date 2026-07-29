import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * BEHAVIOURAL test that the TRAI/DPDP gate actually stops a send.
 *
 * WHY (audit 2026-07-28, §B6): comms-compliance.ts can be perfectly correct and
 * still protect nothing if the send path does not call it, or calls it after the
 * first message has gone out. A blast is not undoable — the check has to run
 * before the provider is touched, and this asserts the provider was never
 * touched, not merely that a 422 came back.
 */

const sendNotification = vi.fn()
vi.mock('@/lib/notification-providers', () => ({
  sendNotification: (...a: unknown[]) => sendNotification(...a),
  substituteVariables: (body: string) => body,
}))

const state = {
  template: null as Record<string, unknown> | null,
  users: [] as Array<Record<string, unknown>>,
  prefs: [] as Array<Record<string, unknown>>,
}
const audits: Array<Record<string, unknown>> = []

vi.mock('@/lib/db', () => ({
  db: {
    notificationTemplate: { findUnique: async () => state.template },
    user: { findMany: async () => state.users },
    communicationPreference: { findMany: async () => state.prefs },
    notificationLog: { create: async () => ({}) },
  },
}))

vi.mock('@/lib/resilience', () => ({
  withTimeout: (p: Promise<unknown>) => p,
  withNeonRetry: (fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/audit', () => ({ logAdminAction: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/with-admin', () => ({
  withAdmin: (_k: string, handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    (req: unknown, _rp?: unknown) =>
      handler(req, {
        adminId: 'admin-1',
        degrade: (_label: string, fallback: unknown) => () => fallback,
        audit: async (entry: Record<string, unknown>) => { audits.push(entry) },
      }),
}))

import { POST } from '@/app/api/admin/notifications/send/route'

const call = (body: Record<string, unknown>) =>
  POST({ json: async () => body } as never, { params: Promise.resolve({}) } as never)

/** An instant expressed in IST, converted to the UTC epoch. */
const atIST = (hour: number) => new Date(Date.UTC(2026, 6, 28, hour, 0) - (5 * 60 + 30) * 60_000)

const PROMO_SMS = {
  id: 'tpl-1', name: 'Sale blast', status: 'active', category: 'promotional',
  channel: 'sms', subject: null, body: 'Big sale today!',
  dltTemplateId: '1107000000000001', dltHeaderId: 'EKBOOK', approvalStatus: 'approved',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  audits.length = 0
  state.users = [{ id: 'u1', email: 'a@b.com', name: 'A', phone: '9800000001', plan: 'free' }]
  state.prefs = []
  sendNotification.mockResolvedValue({ success: true, provider: 'test' })
})

describe('the 2am promotional blast', () => {
  it('is refused, and no provider is called', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(2))
    state.template = PROMO_SMS
    state.prefs = [{ userId: 'u1', channel: 'sms', category: 'promotional', optedIn: true }]

    const res = await call({ mode: 'template', templateId: 'tpl-1', userIds: ['u1'] })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.code).toBe('OUTSIDE_PROMOTIONAL_WINDOW')
    // The only assertion that really matters: nothing was sent.
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('records the refusal, so "the system stopped us" is provable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(2))
    state.template = PROMO_SMS
    state.prefs = [{ userId: 'u1', channel: 'sms', category: 'promotional', optedIn: true }]

    await call({ mode: 'template', templateId: 'tpl-1', userIds: ['u1'] })

    expect(audits.some(a => a.action === 'notification_send_refused')).toBe(true)
  })
})

describe('unregistered promotional SMS', () => {
  it('is refused inside the window when the DLT template id is missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(11))
    state.template = { ...PROMO_SMS, dltTemplateId: null }
    state.prefs = [{ userId: 'u1', channel: 'sms', category: 'promotional', optedIn: true }]

    const res = await call({ mode: 'template', templateId: 'tpl-1', userIds: ['u1'] })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.code).toBe('DLT_TEMPLATE_MISSING')
    expect(body.remedy).toBeTruthy()
    expect(sendNotification).not.toHaveBeenCalled()
  })
})

describe('consent', () => {
  it('sends to nobody when nobody opted in', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(11))
    state.template = PROMO_SMS
    state.prefs = [] // silence is not consent

    const res = await call({ mode: 'template', templateId: 'tpl-1', userIds: ['u1'] })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('NO_CONSENTING_RECIPIENTS')
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('sends only to the user who opted in', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(11))
    state.template = PROMO_SMS
    state.users = [
      { id: 'u1', email: 'a@b.com', name: 'A', phone: '9800000001', plan: 'free' },
      { id: 'u2', email: 'c@d.com', name: 'C', phone: '9800000002', plan: 'free' },
    ]
    state.prefs = [{ userId: 'u1', channel: 'sms', category: 'promotional', optedIn: true }]

    await call({ mode: 'template', templateId: 'tpl-1', userIds: ['u1', 'u2'] })

    expect(sendNotification).toHaveBeenCalledTimes(1)
    expect(sendNotification.mock.calls[0][0].to).toBe('9800000001')
  })

  it('refuses promotional sends to raw addresses, whose consent cannot be known', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(11))
    state.template = null

    const res = await call({
      mode: 'direct', channel: 'sms', category: 'promotional',
      body: 'Big sale!', recipients: ['9800000009'],
    })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.code).toBe('PROMOTIONAL_REQUIRES_KNOWN_USERS')
    expect(sendNotification).not.toHaveBeenCalled()
  })
})

describe('direct mode cannot be used to route around the gate', () => {
  // 🐛 THE BYPASS (audit 2026-07-28): direct mode never set `category`, so it
  // always normalised to "service" and skipped every check. An admin could
  // paste promotional copy, target raw phone numbers and send at 3am simply by
  // not selecting a template. The gate was real and trivially avoidable.
  it('refuses a declared-promotional direct send at any hour, in or out of the window', async () => {
    // Refused for a more fundamental reason than the clock: a raw phone number
    // has no user behind it, so consent cannot be looked up at all. Asserted at
    // 11:00 too, so a future change that only blocks at night still fails here.
    for (const hour of [3, 11]) {
      vi.useFakeTimers()
      vi.setSystemTime(atIST(hour))
      sendNotification.mockClear()

      const res = await call({
        mode: 'direct', channel: 'sms', category: 'promotional',
        body: 'Big sale!', recipients: ['9800000009'],
      })
      const body = await res.json()

      expect(res.status).toBe(422)
      expect(body.code).toBe('PROMOTIONAL_REQUIRES_KNOWN_USERS')
      expect(sendNotification).not.toHaveBeenCalled()
    }
  })

  it('still allows a genuine service message to a raw address', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(3))

    await call({
      mode: 'direct', channel: 'sms',
      body: 'Your account was accessed from a new device.', recipients: ['9800000009'],
    })

    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('audits every direct send with the category the sender claimed', async () => {
    // The category is the sender's CLAIM. Code cannot tell marketing copy from
    // a service notice, so the defence is attribution, not detection.
    vi.useFakeTimers()
    vi.setSystemTime(atIST(11))

    await call({
      mode: 'direct', channel: 'sms', category: 'service',
      body: 'Actually this is marketing', recipients: ['9800000009'],
    })

    const entry = audits.find(a => a.action === 'notification_direct_send')
    expect(entry).toBeDefined()
    expect(String(entry!.description)).toContain('declared category "service"')
    expect(String(entry!.description)).toContain('1 raw address')
  })
})

describe('transactional messages are never blocked', () => {
  it('sends a payment receipt at 3am with no DLT id and no opt-in', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(3))
    state.template = {
      id: 'tpl-2', name: 'Receipt', status: 'active', category: 'transactional',
      channel: 'sms', subject: null, body: 'Payment of Rs 500 received.',
      dltTemplateId: null, dltHeaderId: null, approvalStatus: 'pending',
    }
    state.prefs = []

    await call({ mode: 'template', templateId: 'tpl-2', userIds: ['u1'] })

    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('does not append a STOP instruction to a receipt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(3))
    state.template = {
      id: 'tpl-2', name: 'Receipt', status: 'active', category: 'transactional',
      channel: 'sms', subject: null, body: 'Payment of Rs 500 received.',
    }
    await call({ mode: 'template', templateId: 'tpl-2', userIds: ['u1'] })
    expect(sendNotification.mock.calls[0][0].body).not.toMatch(/STOP/i)
  })
})

describe('every promotional SMS carries a way out', () => {
  it('appends the STOP instruction the template forgot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(atIST(11))
    state.template = PROMO_SMS
    state.prefs = [{ userId: 'u1', channel: 'sms', category: 'promotional', optedIn: true }]

    await call({ mode: 'template', templateId: 'tpl-1', userIds: ['u1'] })

    expect(sendNotification.mock.calls[0][0].body).toMatch(/Reply STOP to opt out\./)
  })
})
