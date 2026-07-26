import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/with-admin'

/**
 * Feature flags are the global kill-switches for the SHOPKEEPER app. Toggling
 * one here changes behaviour for every user of bahikhata-pro.
 *
 * 🔴 THE PRIVILEGE-ESCALATION BUG (audit 2026-07-26, demonstrated live):
 * these handlers checked only `getServerSession()` — "is someone logged in?" —
 * and delegated authorisation to a prefix list in middleware.ts that guarded
 * "/api/admin/feature-flags". The real path is "/api/admin/features", so the
 * guard matched nothing. A read-only `viewer` account was able to run
 *     PATCH /api/admin/features/ai_scanner { "enabled": false }
 * and receive 200 OK, disabling the AI Bill Scanner for the entire app.
 *
 * Authorisation now comes from ROUTE_POLICY via withAdmin(), which resolves the
 * policy for THIS route rather than pattern-matching a URL. The policy is
 * verified against the filesystem by a CI test, so renaming this route breaks
 * the build instead of silently removing its guard.
 */

const ToggleSchema = z.object({
  enabled: z.boolean(),
})

const CreateSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
})

export const PATCH = withAdmin(
  'admin/features/[key]',
  async (req: NextRequest, ctx, { params }) => {
    const { key } = (await params) as { key: string }

    // Validated, not destructured raw. `{"enabled":"yes"}` previously reached
    // Prisma as a string and threw a 500.
    const parsed = ToggleSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Body must be { "enabled": boolean }.',
            requestId: ctx.requestId,
          },
        },
        { status: 400 },
      )
    }
    const { enabled } = parsed.data

    const flag = await db.featureFlag.findUnique({ where: { key } })
    if (!flag) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Feature flag not found.', requestId: ctx.requestId } },
        { status: 404 },
      )
    }

    const before = flag.enabled
    const updated = await db.featureFlag.update({
      where: { key },
      data: { enabled, updatedAt: new Date(), updatedBy: ctx.email },
    })

    await ctx.audit({
      action: 'feature_toggle',
      description: `Toggled "${flag.label}" (${key}) from ${before ? 'ON' : 'OFF'} to ${enabled ? 'ON' : 'OFF'}`,
      targetType: 'feature_flag',
      targetId: key,
      metadata: { before: { enabled: before }, after: { enabled } },
    })

    return NextResponse.json({
      success: true,
      flag: updated,
      message: `"${flag.label}" is now ${enabled ? 'ENABLED' : 'DISABLED'}`,
    })
  },
)

export const POST = withAdmin(
  'admin/features/[key]',
  async (req: NextRequest, ctx, { params }) => {
    const { key } = (await params) as { key: string }

    const parsed = CreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Body must include a label; enabled must be boolean.',
            requestId: ctx.requestId,
          },
        },
        { status: 400 },
      )
    }
    const { label, description, enabled } = parsed.data

    const existing = await db.featureFlag.findUnique({ where: { key } })
    if (existing) {
      return NextResponse.json(
        { error: { code: 'ALREADY_EXISTS', message: 'That flag already exists.', requestId: ctx.requestId } },
        { status: 409 },
      )
    }

    const flag = await db.featureFlag.create({
      data: {
        id: `flag_${key}`,
        key,
        label,
        description,
        enabled,
        updatedAt: new Date(),
        updatedBy: ctx.email,
      },
    })

    await ctx.audit({
      action: 'feature_create',
      description: `Created feature flag "${label}" (${key})`,
      targetType: 'feature_flag',
      targetId: key,
      metadata: { enabled },
    })

    return NextResponse.json({ success: true, flag })
  },
)
