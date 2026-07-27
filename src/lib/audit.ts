import { createHash } from 'crypto'
import { db } from './db'

/**
 * Logs an admin action to the AdminAction audit trail.
 *
 * Every state-changing operation in the admin panel MUST call this.
 * This creates a permanent record of who did what, when, from where.
 *
 * Used for:
 *   - Security forensics (if something goes wrong, we can trace it)
 *   - Compliance (DPDP Act requires audit trails)
 *   - Dispute resolution (user claims their plan was changed without permission)
 *
 * Note: This writes to the AdminAction table which requires WRITE access.
 * Since this is the admin app (not read-only user data), writes are allowed
 * here. The read-only restriction is only for USER data tables.
 */

export interface LogAdminActionParams {
  adminId: string
  action: string
  description: string
  targetType?: string
  targetId?: string
  metadata?: any
  ip?: string
  userAgent?: string
}

/**
 * Actions where a missing audit record is itself unacceptable. If the log
 * cannot be written for one of these, the ACTION must fail — an unrecorded
 * impersonation or export is worse than a failed one.
 */
const MUST_BE_AUDITED = new Set([
  'impersonate',
  'data_export',
  'database_query',
  'database_export',
  'account_closed',
  'bulk_delete',
  'admin_user_create',
  'admin_user_delete',
  'admin_user_role_change',
])

/** Canonical serialisation. Field order is fixed — changing it breaks the chain. */
function computeEntryHash(entry: {
  seq: bigint
  adminId: string
  action: string
  description: string
  targetType?: string | null
  targetId?: string | null
  createdAt: Date
  prevHash: string | null
}): string {
  const canonical = [
    entry.seq.toString(),
    entry.adminId,
    entry.action,
    entry.description,
    entry.targetType ?? '',
    entry.targetId ?? '',
    entry.createdAt.toISOString(),
    entry.prevHash ?? 'GENESIS',
  ].join('\0') // NUL separator — cannot appear in any field, so two
                   // different field splits can never produce one string
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export async function logAdminAction(params: LogAdminActionParams) {
  try {
    // 🔒 TAMPER-EVIDENT CHAIN (audit 2026-07-27). Each entry hashes itself
    // together with the previous entry's hash. Editing or removing any
    // historical row breaks every hash after it, and the break is detectable
    // by scripts/verify-audit-chain.ts.
    //
    // Written in a transaction so the "read the last hash" and "insert linked
    // to it" steps cannot interleave with a concurrent write and fork the
    // chain. READ COMMITTED alone would not prevent that — two writers could
    // both read the same tip. The row lock below serialises them.
    const created = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ hash: string | null }>>`
        SELECT "hash" FROM "AdminAction" ORDER BY "seq" DESC LIMIT 1 FOR UPDATE
      `
      const prevHash = rows[0]?.hash ?? null

      const row = await tx.adminAction.create({
        data: {
          adminId: params.adminId,
          action: params.action,
          description: params.description,
          targetType: params.targetType,
          targetId: params.targetId,
          metadata: params.metadata || undefined,
          ip: params.ip,
          userAgent: params.userAgent,
          prevHash,
        },
      })

      const hash = computeEntryHash({
        seq: row.seq,
        adminId: row.adminId,
        action: row.action,
        description: row.description,
        targetType: row.targetType,
        targetId: row.targetId,
        createdAt: row.createdAt,
        prevHash,
      })

      await tx.adminAction.update({ where: { id: row.id }, data: { hash } })
      return row
    })

    return created
  } catch (error) {
    console.error('[audit] Failed to log admin action:', error)

    // 🔒 (audit 2026-07-27) This used to swallow EVERY failure, so a broken
    // audit table produced a silently unlogged admin action — and the panel
    // carried on as if nothing happened. For most actions degrading is the
    // right call: losing a feature-toggle log should not break the toggle.
    //
    // But for the actions below, the record IS the control. An impersonation
    // or an export that leaves no trace is worse than one that fails, so
    // these rethrow and the caller's action fails with them.
    if (MUST_BE_AUDITED.has(params.action)) {
      throw new Error(
        `Refusing to perform "${params.action}" because it could not be audited.`,
      )
    }
    return null
  }
}

/**
 * Recomputes the whole chain and reports the first entry that does not match.
 * Used by scripts/verify-audit-chain.ts and intended for a scheduled check.
 */
export async function verifyAuditChain(limit = 100_000): Promise<{
  ok: boolean
  checked: number
  brokenAt?: { id: string; seq: string; reason: string }
}> {
  const rows = await db.adminAction.findMany({
    orderBy: { seq: 'asc' },
    take: limit,
    select: {
      id: true, seq: true, adminId: true, action: true, description: true,
      targetType: true, targetId: true, createdAt: true, prevHash: true, hash: true,
    },
  })

  let expectedPrev: string | null = null
  for (const r of rows) {
    // Entries written before the chain existed have no hash; skip but keep order.
    if (r.hash === null) { expectedPrev = null; continue }

    if (r.prevHash !== expectedPrev) {
      return {
        ok: false, checked: rows.length,
        brokenAt: { id: r.id, seq: r.seq.toString(), reason: 'prevHash does not match the preceding entry — a row was inserted or removed' },
      }
    }
    const recomputed = computeEntryHash({ ...r, prevHash: r.prevHash })
    if (recomputed !== r.hash) {
      return {
        ok: false, checked: rows.length,
        brokenAt: { id: r.id, seq: r.seq.toString(), reason: 'contents do not match the stored hash — this entry was edited' },
      }
    }
    expectedPrev = r.hash
  }

  return { ok: true, checked: rows.length }
}

export const __testing = { computeEntryHash }
