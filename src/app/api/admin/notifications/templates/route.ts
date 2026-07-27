import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

/**
 * GET /api/admin/notifications/templates
 *
 * Returns all ACTIVE notification templates (for the compose dropdown).
 * Lightweight: only returns id, name, channel, category, subject, body, variables.
 * No pagination needed — typically <100 active templates.
 *
 * Query params:
 *   - channel: 'all' | 'sms' | 'email' | 'push' (optional filter)
 */
export const GET = withAdmin(
  'admin/notifications/templates',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const channel = url.searchParams.get('channel') || 'all'

    const where: any = { status: 'active' }
    if (channel !== 'all') where.channel = channel

    const templates = await withTimeout(
      db.notificationTemplate.findMany({
        where,
        orderBy: { name: 'asc' },
        take: 500,  // 🔒 V6 SC2: defensive cap (config table, stays small)
        select: {
          id: true,
          name: true,
          channel: true,
          category: true,
          subject: true,
          body: true,
          variables: true,
          language: true,
        },
      }),
      5000
    ).catch(ctx.degrade('notificationTemplate.findMany', []))

    return NextResponse.json({
      success: true,
      templates: (templates as any[]).map((t: any) => ({
        ...t,
        variables: (() => {
          try { return JSON.parse(t.variables) } catch { return [] }
        })(),
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
},
)
