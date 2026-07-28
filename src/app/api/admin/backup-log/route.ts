import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/with-admin'

/**
 * Records and reports daily India-resident backups.
 *
 * WHY (audit 2026-07-28): Rule 46(8) of the Income-tax Rules 2026 requires
 * electronic books to be backed up on servers in India, updated at the close
 * of each business day. Running the backup is only half of it — you have to be
 * able to PROVE the cadence. A backup policy you cannot evidence is not a
 * defence in front of an assessing officer or a diligence process.
 *
 * POST is called by .github/workflows/india-backup.yml with CRON_SECRET.
 * GET shows the founder whether backups are actually happening, including the
 * case that matters most: they silently stopped.
 */

const LogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().max(200),
  status: z.enum(['success', 'failed']),
})

export const POST = withAdmin('admin/backup-log', async (req: NextRequest, ctx) => {
  const parsed = LogSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Expected { date, location, status }.', requestId: ctx.requestId } },
      { status: 400 },
    )
  }
  const { date, location, status } = parsed.data

  await ctx.audit({
    action: status === 'success' ? 'backup_completed' : 'backup_failed',
    description:
      status === 'success'
        ? `India-resident backup written for business day ${date} to ${location}`
        : `India-resident backup FAILED for business day ${date}`,
    targetType: 'backup',
    targetId: date,
    metadata: { date, location, status },
  })

  return NextResponse.json({ success: true, recorded: date, status })
})

export const GET = withAdmin('admin/backup-log', async (_req: NextRequest, ctx) => {
  const entries = await db.adminAction.findMany({
    where: { action: { in: ['backup_completed', 'backup_failed'] } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { action: true, targetId: true, createdAt: true, description: true },
  }).catch(ctx.degrade('adminAction.findMany', [] as any[]))

  const successes = entries.filter((e: any) => e.action === 'backup_completed')
  const lastSuccess = successes[0]

  // Days since the last successful backup. This is the number that matters:
  // "we have backups" is a belief, "the last one was 9 days ago" is a fact.
  const daysSince = lastSuccess
    ? Math.floor((Date.now() - new Date(lastSuccess.createdAt).getTime()) / 86_400_000)
    : null

  // The dangerous state is not "failed" — a failure is loud. It is a job that
  // silently stopped firing, where nothing appears at all and the absence
  // looks like calm.
  const compliant = daysSince !== null && daysSince <= 1

  return NextResponse.json({
    success: true,
    compliant,
    rule: 'Income-tax Rules 2026, Rule 46(8) — daily backup on servers located in India',
    lastSuccessfulBackup: lastSuccess?.targetId ?? null,
    daysSinceLastBackup: daysSince,
    warning: compliant
      ? null
      : daysSince === null
        ? 'No successful backup has ever been recorded. The daily India backup is not running.'
        : `The last successful backup was ${daysSince} days ago. The daily job has stopped.`,
    recent: entries.slice(0, 30).map((e: any) => ({
      businessDate: e.targetId,
      status: e.action === 'backup_completed' ? 'success' : 'failed',
      recordedAt: e.createdAt,
    })),
  })
})
