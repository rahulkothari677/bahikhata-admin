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

export async function logAdminAction(params: LogAdminActionParams) {
  try {
    await db.adminAction.create({
      data: {
        adminId: params.adminId,
        action: params.action,
        description: params.description,
        targetType: params.targetType,
        targetId: params.targetId,
        metadata: params.metadata || undefined,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    })
  } catch (error) {
    // Don't fail the request if logging fails — but do log it
    console.error('[audit] Failed to log admin action:', error)
  }
}
