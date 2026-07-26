/**
 * PII masking helpers.
 *
 * WHY (audit 2026-07-26): DPDP purpose limitation. An admin screen should show
 * identifiers only when the task at hand needs them. Support resolving a
 * ticket needs a phone number; a founder glancing at a dashboard does not.
 *
 * Masking is the DEFAULT. Unmasking is an explicit, reason-logged, audited act
 * (Phase 2). Masking in a React component is NOT masking — the raw value still
 * crossed the wire and sits in the browser's network tab. These helpers must be
 * applied server-side, in the route's serialisation step.
 *
 * These are one-way and lossy on purpose. Do not "improve" them into something
 * reversible.
 */

/** ram@kirana.com -> r••@k••••••.com */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at <= 0) return '•••'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const domainName = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  return `${local[0]}${'•'.repeat(Math.max(local.length - 1, 1))}@${domainName[0]}${'•'.repeat(Math.max(domainName.length - 1, 1))}${tld}`
}

/** Ramesh Kumar -> R••••• K••••  */
export function maskName(name: string | null | undefined): string | null {
  if (!name) return null
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]}${'•'.repeat(Math.max(part.length - 1, 1))}`)
    .join(' ')
}

/** 9876543210 -> 98••••••10 (keeps enough for a support agent to confirm) */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 6) return '•'.repeat(digits.length || 3)
  return `${digits.slice(0, 2)}${'•'.repeat(digits.length - 4)}${digits.slice(-2)}`
}

/** 27AAPFU0939F1ZV -> 27•••••••••••ZV (state code + check digit stay legible) */
export function maskGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null
  if (gstin.length < 6) return '•'.repeat(gstin.length)
  return `${gstin.slice(0, 2)}${'•'.repeat(gstin.length - 4)}${gstin.slice(-2)}`
}

/**
 * A stable, non-reversible pseudonym for correlating events belonging to the
 * same user WITHOUT revealing who they are. Use this in activity feeds and
 * analytics where "same actor" matters but identity does not.
 *
 * Deliberately truncated: enough to group, not enough to be a lookup key.
 */
export function pseudonym(userId: string | null | undefined): string | null {
  if (!userId) return null
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i)
    hash |= 0
  }
  return `user_${Math.abs(hash).toString(36).slice(0, 6)}`
}
