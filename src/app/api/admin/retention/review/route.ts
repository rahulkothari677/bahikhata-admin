import { NextRequest, NextResponse } from 'next/server'
import { dbRead } from '@/lib/db'
import { withAdmin } from '@/lib/with-admin'
import { isPurgeEligible, STATUTORY_RETENTION_YEARS } from '@/lib/soft-delete'

/**
 * Retention review — REPORTS what has passed its statutory retention period.
 * It deliberately deletes NOTHING.
 *
 * WHY IT ONLY REPORTS (audit 2026-07-27):
 * Closing an account sets `retentionUntil` 8 years out, clearing both the GST
 * s.36 (72 months) and IT Rule 6F (6 years) obligations. Something has to act
 * when that date passes, or "retention policy" is just a column nobody reads.
 *
 * But an automated purge job is the single most dangerous piece of code that
 * could exist in this system. It runs unattended, it deletes customer records,
 * and a bug in its date arithmetic — an off-by-one year, a timezone slip, a
 * null treated as zero — destroys books that are still legally required. There
 * is no undo. The founder's stated first priority is that user data is never
 * lost "at any cost, no matter what."
 *
 * So: this surfaces candidates and a founder decides. Deletion, if it ever
 * happens, is a deliberate human act against a named list — not a cron job
 * that quietly does the right thing 2,920 times and the wrong thing once.
 *
 * The database backs this up: prisma/grants/admin-role.sql revokes DELETE from
 * the admin role entirely, so even a future automated purge written by someone
 * else could not execute through this app.
 */
export const GET = withAdmin('admin/retention/review', async (_req: NextRequest, ctx) => {
  const now = new Date()

  const closed = await dbRead.user.findMany({
    where: { deletedAt: { not: null } },
    select: {
      id: true,
      deletedAt: true,
      deletedBy: true,
      deletionReason: true,
      retentionUntil: true,
      anonymisedAt: true,
      txnCount: true,
    },
    orderBy: { retentionUntil: 'asc' },
    take: 500,
  }).catch(ctx.degrade('user.findMany', [] as any[]))

  const eligible = closed.filter((u: any) => isPurgeEligible(u.retentionUntil, now))
  const retained = closed.filter((u: any) => !isPurgeEligible(u.retentionUntil, now))

  // A closed account with NO retentionUntil predates the retention work. It is
  // never purge-eligible — unknown retention means keep, not "no constraint" —
  // but it should be surfaced so the date can be backfilled deliberately.
  const missingRetentionDate = closed.filter((u: any) => !u.retentionUntil)

  return NextResponse.json({
    success: true,
    policy: {
      retentionYears: STATUTORY_RETENTION_YEARS,
      basis: 'GST s.36 (72 months) and IT Rule 6F (6 years); 8 years clears both with margin.',
      deletionIsManual: true,
      note:
        'This endpoint reports only. Nothing is deleted automatically, and the ' +
        'admin database role has DELETE revoked, so it could not be.',
    },
    summary: {
      closedAccounts: closed.length,
      pastRetention: eligible.length,
      stillRetained: retained.length,
      missingRetentionDate: missingRetentionDate.length,
    },
    // Ids only. This is an operational review, not a reason to page through
    // closed customers' details.
    pastRetention: eligible.map((u: any) => ({
      id: u.id,
      closedAt: u.deletedAt,
      retentionExpired: u.retentionUntil,
      transactionsHeld: u.txnCount,
      alreadyAnonymised: u.anonymisedAt !== null,
    })),
    needsRetentionDate: missingRetentionDate.map((u: any) => ({
      id: u.id,
      closedAt: u.deletedAt,
    })),
  })
})
