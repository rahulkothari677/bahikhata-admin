/**
 * API Key Generator — cryptographically secure key generation + hashing.
 *
 * SECURITY MODEL:
 *   1. Generate a random 32-byte key → base64url encode → prefix with "bkh_live_"
 *   2. Show the FULL key to admin ONCE (on creation) — they must save it
 *   3. Store only the SHA-256 hash in DB (never the raw key)
 *   4. Store the first 12 chars as "keyPrefix" for display (bkh_live_abc1...)
 *   5. On API requests, hash the provided key and compare to stored hash
 *
 * KEY FORMAT:
 *   bkh_live_<48 chars of base64url>    (total: ~58 chars)
 *   Example: bkh_live_AbCdEf1234567890...
 *
 * SCOPES:
 *   - read_leads: GET lead data (credit scores for lending)
 *   - write_leads: POST lead status updates (approved/rejected)
 *   - read_analytics: GET aggregate analytics (market intelligence)
 *   - read_users: GET user data (anonymized)
 *   - read_revenue: GET revenue/share data
 *   - admin: full access (use sparingly)
 */

import crypto from 'crypto'

export const KEY_PREFIX = 'bkh_live_'

// =====================================================================
// GENERATE NEW API KEY
// =====================================================================
// Returns { rawKey, keyHash, keyPrefix }
//   - rawKey: the FULL key (shown to user ONCE — they must save it)
//   - keyHash: SHA-256 hash (stored in DB)
//   - keyPrefix: first 12 chars (stored in DB for display)
// =====================================================================

export interface GeneratedKey {
  rawKey: string      // FULL key — return to user ONCE, never stored
  keyHash: string     // SHA-256 hash — store in DB
  keyPrefix: string   // first 12 chars — store in DB for display
}

export function generateApiKey(): GeneratedKey {
  // Generate 32 random bytes → base64url (no padding, URL-safe)
  const randomBytes = crypto.randomBytes(32)
  const encoded = randomBytes.toString('base64url') // 43 chars, URL-safe

  const rawKey = `${KEY_PREFIX}${encoded}` // e.g. bkh_live_AbCdEf... (total ~52 chars)
  const keyHash = hashApiKey(rawKey)
  const keyPrefix = rawKey.slice(0, 12) // e.g. bkh_live_AbC

  return { rawKey, keyHash, keyPrefix }
}

// =====================================================================
// HASH API KEY (SHA-256)
// =====================================================================
// Used for:
//   1. Storing the hash on creation
//   2. Comparing on API requests
// =====================================================================

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

// =====================================================================
// VERIFY API KEY (compare raw key to stored hash)
// =====================================================================

export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const hash = hashApiKey(rawKey)
  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch {
    return false
  }
}

// =====================================================================
// SCOPE DEFINITIONS
// =====================================================================

export interface ScopeConfig {
  key: string
  label: string
  description: string
}

export const SCOPE_CONFIGS: ScopeConfig[] = [
  {
    key: 'read_leads',
    label: 'Read Leads',
    description: 'GET credit-scored leads (for NBFC lending partners)',
  },
  {
    key: 'write_leads',
    label: 'Write Leads',
    description: 'POST lead status updates (approved/rejected by partner)',
  },
  {
    key: 'read_analytics',
    label: 'Read Analytics',
    description: 'GET aggregate market analytics (for FMCG supplier intelligence)',
  },
  {
    key: 'read_users',
    label: 'Read Users (Anonymized)',
    description: 'GET anonymized user data (no PII — for market research)',
  },
  {
    key: 'read_revenue',
    label: 'Read Revenue',
    description: 'GET revenue and payout data (for partner reconciliation)',
  },
  {
    key: 'admin',
    label: 'Admin (Full Access)',
    description: 'Full access to all endpoints — use sparingly, only for trusted internal integrations',
  },
]

export const VALID_SCOPES = SCOPE_CONFIGS.map(s => s.key)

// =====================================================================
// CHECK IF KEY HAS SCOPE
// =====================================================================

export function hasScope(scopes: string[], requiredScope: string): boolean {
  // 'admin' scope grants all access
  if (scopes.includes('admin')) return true
  return scopes.includes(requiredScope)
}

// =====================================================================
// PARSE SCOPES FROM DB (JSON string → array)
// =====================================================================

export function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson)
    if (Array.isArray(parsed)) {
      return parsed.filter(s => VALID_SCOPES.includes(s))
    }
  } catch {}
  return []
}

// =====================================================================
// SERIALIZE SCOPES FOR DB (array → JSON string)
// =====================================================================

export function serializeScopes(scopes: string[]): string {
  return JSON.stringify(scopes.filter(s => VALID_SCOPES.includes(s)))
}
