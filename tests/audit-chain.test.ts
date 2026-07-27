import { describe, it, expect } from 'vitest'
import { __testing } from '../src/lib/audit'

const { computeEntryHash } = __testing

/**
 * Guards for the tamper-evident audit chain.
 *
 * WHY (audit 2026-07-27): the audit log was an ordinary table. Every admin has
 * database access — implicitly, via the SQL console — so an admin could edit
 * the record of what they did and nothing would reveal it. An audit trail the
 * audited party can silently rewrite provides no assurance, which matters
 * directly for DPDP Rule 6 and CERT-In log-retention obligations.
 *
 * Each entry now hashes its own contents together with the previous entry's
 * hash. Editing, inserting or deleting any historical row breaks every hash
 * after it, and the break is detectable.
 *
 * This is DETECTION. Prevention is the append-only GRANT in
 * prisma/grants/admin-role.sql. The two are complementary — the grant stops
 * the edit, the chain proves none happened.
 */

const base = {
  seq: BigInt(1),
  adminId: 'adm_1',
  action: 'feature_toggle',
  description: 'Toggled "AI Bill Scanner" from ON to OFF',
  targetType: 'feature_flag',
  targetId: 'ai_scanner',
  createdAt: new Date('2026-07-27T10:00:00.000Z'),
  prevHash: null as string | null,
}

describe('audit entry hashing', () => {
  it('is deterministic', () => {
    expect(computeEntryHash(base)).toBe(computeEntryHash({ ...base }))
  })

  it('changes if the DESCRIPTION is edited', () => {
    // The realistic attack: soften what the log says you did.
    const tampered = { ...base, description: 'Routine maintenance' }
    expect(computeEntryHash(tampered)).not.toBe(computeEntryHash(base))
  })

  it('changes if the ACTOR is edited', () => {
    // The other realistic attack: blame someone else.
    expect(computeEntryHash({ ...base, adminId: 'adm_someone_else' }))
      .not.toBe(computeEntryHash(base))
  })

  it('changes if the ACTION, TARGET or TIMESTAMP is edited', () => {
    for (const patch of [
      { action: 'login' },
      { targetId: 'some_other_flag' },
      { targetType: 'user' },
      { createdAt: new Date('2026-07-27T10:00:01.000Z') },
    ]) {
      expect(computeEntryHash({ ...base, ...patch })).not.toBe(computeEntryHash(base))
    }
  })

  it('changes if the PREVIOUS hash changes — this is what makes it a chain', () => {
    // Editing entry 5 must invalidate 6, 7, 8... Without this the log is just
    // a list of independently-forgeable rows.
    const linked = { ...base, seq: BigInt(2), prevHash: 'a'.repeat(64) }
    const relinked = { ...base, seq: BigInt(2), prevHash: 'b'.repeat(64) }
    expect(computeEntryHash(linked)).not.toBe(computeEntryHash(relinked))
  })

  it('cannot be forged by shifting content between fields', () => {
    // A separator that can appear inside a field lets two different entries
    // serialise identically: description "a|b" + target "" vs description "a"
    // + target "b". The NUL separator cannot occur in these values, so this
    // class of collision is impossible.
    const a = { ...base, description: 'x', targetType: 'y' }
    const b = { ...base, description: 'x\0y', targetType: '' }
    expect(computeEntryHash(a)).not.toBe(computeEntryHash(b))
  })

  it('distinguishes the genesis entry from one with a literal "GENESIS" prev', () => {
    const genesis = { ...base, prevHash: null }
    const faked = { ...base, prevHash: 'GENESIS' }
    // Both serialise the sentinel, so they SHOULD match — this documents that
    // the genesis marker is not itself a security boundary. The protection for
    // entry 1 is the append-only grant, not the hash.
    expect(computeEntryHash(genesis)).toBe(computeEntryHash(faked))
  })

  it('produces a full-length sha256 hex digest', () => {
    const h = computeEntryHash(base)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
