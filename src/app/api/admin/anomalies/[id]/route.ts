import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/with-admin'

/**
 * PATCH /api/admin/anomalies/[id]
 *
 * Triage a detected anomaly: acknowledge or resolve, with a note.
 *
 * MIGRATED to withAdmin (audit 2026-07-26). Same defect as fraud-alerts/[id]:
 * only `getServerSession()` was checked, so any logged-in account — including a
 * read-only viewer — could mark anomalies resolved. Anomalies are the
 * early-warning signal for revenue drops and cost spikes; clearing them
 * silently is how a real incident goes unnoticed.
 *
 * The 500 path also returned `String(error).slice(0, 300)` to the client,
 * leaking Prisma internals. withAdmin returns a typed shape with a requestId.
 */

const PatchSchema = z
  .object({
    status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
    adminNote: z.string().max(2000).optional(),
  })
  .refine((v) => v.status !== undefined || v.adminNote !== undefined, {
    message: 'Provide status or adminNote.',
  })

export const PATCH = withAdmin(
  'admin/anomalies/[id]',
  async (req: NextRequest, ctx, { params }) => {
    const { id } = (await params) as { id: string }

    const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'status must be one of open|acknowledged|resolved.',
            requestId: ctx.requestId,
          },
        },
        { status: 400 },
      )
    }
    const { status, adminNote } = parsed.data

    const existing = await db.anomaly.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Anomaly not found.', requestId: ctx.requestId } },
        { status: 404 },
      )
    }

    const now = new Date()
    const updateData: Record<string, unknown> = {
      ...(status !== undefined && { status }),
      ...(adminNote !== undefined && { adminNote }),
    }

    // First acknowledgement/resolution wins — attribution is never overwritten.
    if (status === 'acknowledged' && !existing.acknowledgedAt) {
      updateData.acknowledgedBy = ctx.adminId
      updateData.acknowledgedAt = now
    }
    if (status === 'resolved' && !existing.resolvedAt) {
      updateData.resolvedBy = ctx.adminId
      updateData.resolvedAt = now
    }

    const updated = await db.anomaly.update({ where: { id }, data: updateData })

    await ctx.audit({
      action: 'anomaly_status_change',
      description:
        `Anomaly "${existing.metricLabel}" (${existing.direction}) status: ` +
        `${existing.status} -> ${status ?? existing.status}`,
      targetType: 'anomaly',
      targetId: id,
      metadata: {
        before: existing.status,
        after: status ?? existing.status,
        metric: existing.metricLabel,
      },
    })

    return NextResponse.json({ success: true, anomaly: updated })
  },
)
