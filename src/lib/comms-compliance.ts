/**
 * TRAI / DPDP gating for anything that sends a message to a shopkeeper.
 *
 * WHY (audit 2026-07-28, master report §B6): `notifications/send`, `campaigns`
 * and `segments` together let an admin message every user in the product. That
 * is commercial communication and it is regulated — but nothing in the send
 * path checked any of it. A promotional SMS blast at 2am to users who never
 * opted in was three clicks away, and would have been legal exposure for the
 * company rather than a bug in a screen.
 *
 * What the law actually requires (as at July 2026):
 *
 *   SMS   — TRAI TCCCPR. The entity, the header (sender ID) and every content
 *           template must be registered on a DLT portal. Promotional sends are
 *           restricted to 10:00–21:00 IST. Marketing needs double opt-in with
 *           the consent record stored, and every promotional message carries a
 *           STOP instruction.
 *   WhatsApp — DLT does NOT apply. Meta's Business Messaging Policy does, via
 *           an approved BSP. Do not "enforce DLT" on it; that is cargo cult.
 *   Email — no DLT, but DPDP consent and withdrawal apply.
 *   Push  — OS-level consent, plus purpose limitation.
 *
 * The rule this module encodes: TRANSACTIONAL messages about the user's own
 * activity flow freely (they are contract performance). PROMOTIONAL messages
 * are blocked unless every condition is met.
 */

/** Message categories that matter legally. Anything else is treated as service. */
export type MessageCategory = 'transactional' | 'service' | 'promotional'

export type Channel = 'sms' | 'email' | 'push' | 'whatsapp'

/**
 * TRAI's promotional window, in IST. Inclusive of 10:00, exclusive of 21:00.
 */
export const PROMO_WINDOW_IST = { startHour: 10, endHour: 21 } as const

/** India is UTC+5:30 year-round. No DST — this offset is safe to hardcode. */
const IST_OFFSET_MINUTES = 5 * 60 + 30

/**
 * The hour and minute in IST, computed from an absolute instant.
 *
 * Deliberately NOT `toLocaleString('en-IN')` or anything reading the server's
 * clock: Vercel runs in UTC, a developer's laptop does not, and this codebase
 * has shipped timezone bugs before. Arithmetic on the epoch is the only form
 * that gives the same answer everywhere.
 */
export function istParts(now: Date = new Date()): { hour: number; minute: number } {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000
  const ist = new Date(istMs)
  return { hour: ist.getUTCHours(), minute: ist.getUTCMinutes() }
}

export function isWithinPromotionalWindow(now: Date = new Date()): boolean {
  const { hour } = istParts(now)
  return hour >= PROMO_WINDOW_IST.startHour && hour < PROMO_WINDOW_IST.endHour
}

/** Normalises the free-text `category` column to the three regulated values. */
export function normaliseCategory(raw: string | null | undefined): MessageCategory {
  const v = (raw ?? '').toLowerCase().trim()
  if (v === 'promotional' || v === 'marketing') return 'promotional'
  if (v === 'transactional') return 'transactional'
  // 'general', 'payment', 'onboarding', 'churn' and anything unrecognised are
  // service messages: about the user's own account, not selling to them.
  return 'service'
}

export type SendRefusal = {
  code:
    | 'DLT_TEMPLATE_MISSING'
    | 'DLT_HEADER_MISSING'
    | 'TEMPLATE_NOT_APPROVED'
    | 'OUTSIDE_PROMOTIONAL_WINDOW'
  message: string
  /** What the operator should do about it. Refusals without this get ignored. */
  remedy: string
}

export type TemplateForSend = {
  category?: string | null
  channel: string
  dltTemplateId?: string | null
  dltHeaderId?: string | null
  approvalStatus?: string | null
}

/**
 * Decides whether this template may be sent right now.
 *
 * Returns null when the send is allowed, or the reason it is refused. The
 * caller must not send on a refusal — and must show `remedy`, because a
 * blocked send with no explanation gets worked around rather than fixed.
 */
export function checkSendAllowed(
  template: TemplateForSend,
  now: Date = new Date(),
): SendRefusal | null {
  const category = normaliseCategory(template.category)

  // Transactional and service messages are contract performance. Gating them
  // would break password resets and payment receipts, which is both wrong and
  // the fastest way to get this whole module deleted.
  if (category !== 'promotional') return null

  // SMS is the DLT-regulated channel. WhatsApp is governed by Meta's policy
  // through a BSP, and email/push by DPDP consent — none of them carry a DLT
  // template id, so requiring one would be a check that cannot be satisfied.
  if (template.channel === 'sms') {
    if (!template.dltTemplateId?.trim()) {
      return {
        code: 'DLT_TEMPLATE_MISSING',
        message: 'Promotional SMS requires a registered DLT content template ID.',
        remedy:
          'Register this template on your DLT portal (Jio/Airtel/Vi), then paste the returned template ID onto this template before sending.',
      }
    }
    if (!template.dltHeaderId?.trim()) {
      return {
        code: 'DLT_HEADER_MISSING',
        message: 'Promotional SMS requires a registered DLT header (sender ID).',
        remedy: 'Add the registered sender ID (header) for this template on the DLT portal.',
      }
    }
    if ((template.approvalStatus ?? 'pending') !== 'approved') {
      return {
        code: 'TEMPLATE_NOT_APPROVED',
        message: 'This promotional template has not been marked approved.',
        remedy:
          'Confirm the template is approved on the DLT portal, then set its approval status to "approved" here.',
      }
    }
  }

  // The time window applies to promotional content on every channel. TRAI
  // mandates it for SMS; sending marketing push at 3am is a bad idea anyway,
  // and a single rule is one people can actually remember.
  if (!isWithinPromotionalWindow(now)) {
    const { hour, minute } = istParts(now)
    return {
      code: 'OUTSIDE_PROMOTIONAL_WINDOW',
      message: `Promotional messages may only be sent between ${PROMO_WINDOW_IST.startHour}:00 and ${PROMO_WINDOW_IST.endHour}:00 IST. It is currently ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} IST.`,
      remedy: `Schedule this send for after ${PROMO_WINDOW_IST.startHour}:00 IST.`,
    }
  }

  return null
}

/**
 * Splits recipients into those who may receive this message and those who may
 * not, given their stored preferences.
 *
 * Absence of a preference row is treated as: transactional and service YES
 * (contract performance — a payment receipt is not marketing), promotional NO.
 * Opt-in must be a positive act; silence is not consent under DPDP.
 */
export function partitionByConsent<T extends { userId: string }>(
  recipients: T[],
  category: MessageCategory,
  channel: Channel,
  preferences: Array<{ userId: string; channel: string; category: string; optedIn: boolean }>,
): { allowed: T[]; blocked: Array<T & { reason: string }> } {
  if (category !== 'promotional') {
    return { allowed: recipients, blocked: [] }
  }

  const optedIn = new Set(
    preferences
      .filter(p => p.optedIn && p.channel === channel && normaliseCategory(p.category) === 'promotional')
      .map(p => p.userId),
  )

  const allowed: T[] = []
  const blocked: Array<T & { reason: string }> = []
  for (const r of recipients) {
    if (optedIn.has(r.userId)) allowed.push(r)
    else blocked.push({ ...r, reason: 'no promotional opt-in on record' })
  }
  return { allowed, blocked }
}

/**
 * Every promotional message must carry a way out. Appended server-side rather
 * than trusted to the template, because a template missing it is a compliance
 * breach and templates are edited by people in a hurry.
 */
export const STOP_INSTRUCTION_SMS = 'Reply STOP to opt out.'

export function ensureStopInstruction(body: string, category: MessageCategory, channel: Channel): string {
  if (category !== 'promotional') return body
  if (channel !== 'sms') return body
  if (/\bstop\b/i.test(body)) return body
  return `${body.trimEnd()}\n${STOP_INSTRUCTION_SMS}`
}
