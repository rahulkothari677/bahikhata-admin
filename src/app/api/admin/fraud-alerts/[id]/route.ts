import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/with-admin'

/**
 * PATCH /api/admin/fraud-alerts/[id]
 *
 * Triage a fraud alert: acknowledge, resolve, or mark it a false positive.
 *
 * MIGRATED to withAdmin (audit 2026-07-26). Previously this checked only
 * `getServerSession()` — "is anyone logged in?" — so any account including a
 * read-only viewer could clear fraud alerts. Silently dismissing alerts is a
 * quiet way to hide abuse: the alert disappears and nothing says who cleared
 * it or why. Authorisation now comes from ROUTE_POLICY (analyst or founder).
 *
 * It also leaked internals: the 500 path returned
 *     detail: String(error).slice(0, 300)
 * straight to the client, which surfaces Prisma messages and column names.
 * withAdmin returns a typed shape with a requestId; the detail goes to the log.
 */

const PatchSchema = z
  .object({
    status: z.enum(['open', 'acknowledged', 'resolved', 'false_positive']).optional(),
    adminNote: z.string().max(2000).optional(),
  })
  .refine((v) => v.status !== undefined || v.adminNote !== undefined, {
    message: 'Provide status or adminNote.',
  })

export const PATCH = withAdmin(
  'admin/fraud-alerts/[id]',
  async (req: NextRequest, ctx, { params }) => {
    const { id } = (await params) as { id: string }

    const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'status must be one of open|acknowledged|resolved|false_positive.',
            requestId: ctx.requestId,
          },
        },
        { status: 400 },
      )
    }
    const { status, adminNote } = parsed.data

    const existing = await db.fraudAlert.findUnique({
      where: { id },
      include: { rule: { select: { name: true } } },
    })
    if (!existing) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Alert not found.', requestId: ctx.requestId } },
        { status: 404 },
      )
    }

    const now = new Date()
    const updateData: Record<string, unknown> = {
      ...(status !== undefined && { status }),
      ...(adminNote !== undefined && { adminNote }),
    }

    // Attribution is written once and never overwritten, so the record shows
    // who FIRST acknowledged or resolved an alert.
    if (status === 'acknowledged' && !existing.acknowledgedAt) {
      updateData.acknowledgedBy = ctx.adminId
      updateData.acknowledgedAt = now
    }
    if ((status === 'resolved' || status === 'false_positive') && !existing.resolvedAt) {
      updateData.resolvedBy = ctx.adminId
      updateData.resolvedAt = now
    }

    const updated = await db.fraudAlert.update({ where: { id }, data: updateData })

    await ctx.audit({
      action: 'fraud_alert_status_change',
      description:
        `Fraud alert for rule "${existing.rule?.name}" status: ` +
        `${existing.status} -> ${status ?? existing.status}`,
      targetType: 'fraud_alert',
      targetId: id,
      // The alert's subject is identified by id only. The audit entry does not
      // need to restate the shopkeeper's name to be useful.
      metadata: { before: existing.status, after: status ?? existing.status, noteChanged: adminNote !== undefined },
    })

    return NextResponse.json({ success: true, alert: updated })
  },
)
