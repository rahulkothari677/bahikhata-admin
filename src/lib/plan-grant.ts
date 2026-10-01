/**
 * Granting a plan — ONE rule, used by every path that changes a user's plan.
 *
 * 🐛 2026-10-02. Rahul: "i am not able to upgrade the user to elite."
 *
 * The main app does not believe `user.plan`. For 'pro' and 'elite' its
 * getUserPlan() looks for an ACTIVE, unexpired Subscription row and returns
 * 'free' when there is none (main app, src/lib/usage-limits.ts — the V26 F3
 * expiry fix). `user.plan` is a claim; the Subscription row is the proof.
 *
 * Commit fa17955 found that bulk "change plan" set only `user.plan`, reported
 * "100 users changed to pro", and upgraded nobody — and fixed it by writing a
 * Subscription row INSIDE the bulk handler. The single-user upgrade on the user
 * detail page, the button Rahul was using, had the identical defect and kept
 * it: two copies of one rule, one corrected. Every elite upgrade made from that
 * page would have said "Plan changed to elite" while the shopkeeper's app went
 * on treating them as free. (CLAUDE.md, Cause 2: two things describing one
 * thing WILL disagree.)
 *
 * So the rule lives here and both paths call it.
 *
 * MUST be called inside a transaction: the user row and the subscription
 * disagreeing — paid plan on the user, no proof behind it — is the exact state
 * this exists to prevent, and a half-applied grant produces it.
 */

export type GrantablePlan = 'free' | 'pro' | 'elite'
export const GRANTABLE_PLANS: readonly GrantablePlan[] = ['free', 'pro', 'elite']

export function isGrantablePlan(p: unknown): p is GrantablePlan {
  return typeof p === 'string' && (GRANTABLE_PLANS as readonly string[]).includes(p)
}

/** The default length of an admin grant when no end date is given. */
export const ADMIN_GRANT_DAYS = 30

/** The minimal slice of a Prisma transaction client this needs — so a test can pass a fake. */
export interface PlanGrantTx {
  user: { updateMany(args: unknown): Promise<{ count: number }> }
  subscription: {
    updateMany(args: unknown): Promise<{ count: number }>
    createMany(args: unknown): Promise<{ count: number }>
  }
}

export interface PlanGrant {
  userIds: string[]
  plan: GrantablePlan
  /** When the grant ends. Defaults to ADMIN_GRANT_DAYS from now; ignored for 'free'. */
  endDate?: Date | null
  now?: Date
  /** Prefix for the Subscription ids, so a grant's origin is readable in the table. */
  source: 'admin' | 'adminbulk'
}

/**
 * Apply a plan to users: the user row AND the subscription that proves it.
 *
 * Returns how many user rows changed. Any previous active grant is expired in
 * BOTH directions — an upgrade supersedes it, and a downgrade to free must not
 * leave an 'active' row behind to contradict the user record.
 */
export async function applyPlanGrant(tx: PlanGrantTx, grant: PlanGrant): Promise<number> {
  const now = grant.now ?? new Date()
  const end =
    grant.plan === 'free'
      ? null
      : grant.endDate ?? new Date(now.getTime() + ADMIN_GRANT_DAYS * 24 * 60 * 60 * 1000)

  const res = await tx.user.updateMany({
    where: { id: { in: grant.userIds } },
    data: {
      plan: grant.plan,
      renewsAt: end,
      // A fresh grant is not a cancelled one. The single-user path cleared this
      // and the bulk path did not; one rule now, so both do.
      cancelledAt: null,
      // Revokes the user's existing session tokens so the new plan applies at
      // once rather than after the JWT expires (integration phase D.4).
      tokenVersion: { increment: 1 },
    },
  })

  await tx.subscription.updateMany({
    where: { userId: { in: grant.userIds }, status: 'active' },
    data: { status: 'expired' },
  })

  if (grant.plan !== 'free') {
    await tx.subscription.createMany({
      data: grant.userIds.map((uid) => ({
        // Subscription.id has no database default — it must be supplied.
        id: `${grant.source}_${uid}_${now.getTime()}`,
        userId: uid,
        plan: grant.plan,
        status: 'active',
        amount: 0, // granted by an admin, not paid for
        paymentMode: 'admin_grant',
        startDate: now,
        endDate: end,
      })),
      skipDuplicates: true,
    })
  }

  return res.count
}
