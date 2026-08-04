import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { verifyAuditChain } from '@/lib/audit'

/**
 * GET /api/admin/audit-chain/verify
 *
 * 🔒 2026-08-04 (Phase 7 audit). The admin audit log is a hash chain: each
 * entry stores the hash of the one before it, so editing or removing a row
 * breaks every hash after it. `verifyAuditChain()` recomputes the whole chain
 * and names the first entry that does not match.
 *
 * It was written correctly, tested thoroughly (tests/audit-chain.test.ts proves
 * the hash changes if the actor, action, description, target or timestamp is
 * edited), and shipped with a script at scripts/verify-audit-chain.ts.
 *
 * Nothing ever called it. Not a route, not a test, not a workflow. Seven jobs
 * run on a schedule — daily stats, anomaly detection, churn, revenue
 * recognition, fraud rules, bulk jobs, webhook delivery — and the one that
 * detects tampering with the record of who did what was not among them.
 *
 * A tamper-EVIDENT log nobody ever inspects is not tamper-evident. Tampering
 * stays theoretically detectable and practically undetected, which is worse
 * than having no chain at all: the chain is why everyone believes the log.
 *
 * Now runs nightly (.github/workflows/admin-cron.yml). A broken chain returns
 * HTTP 500 so the workflow step fails loudly and goes to Sentry — a silent
 * 200 would recreate the original problem in a new place.
 *
 * Read-only: it recomputes hashes and compares. It never writes to the chain,
 * because a verifier that can edit what it verifies proves nothing.
 */
export const GET = withAdmin('admin/audit-chain/verify', async (_req: NextRequest, ctx) => {
  const started = Date.now()
  const result = await verifyAuditChain()
  const durationMs = Date.now() - started

  if (!result.ok) {
    // Deliberately loud. This is the one alert that must never be swallowed:
    // it means the record of every admin action is no longer trustworthy.
    const detail =
      `Admin audit chain BROKEN at seq ${result.brokenAt?.seq} ` +
      `(entry ${result.brokenAt?.id}): ${result.brokenAt?.reason}`
    console.error(`[audit-chain] ${detail}`)

    // Append the finding to the chain itself. The entries after a break are
    // still trustworthy relative to each other, so this records WHEN the break
    // was noticed — which bounds the window an investigator has to search.
    // Only on failure: a nightly "all fine" entry would bury the real ones.
    await ctx.audit({
      action: 'audit_chain_broken',
      description: detail,
      targetType: 'audit_chain',
      targetId: result.brokenAt?.id,
      metadata: { brokenAt: result.brokenAt, checked: result.checked },
    })

    // 500 so the scheduled job fails visibly rather than reporting success.
    return NextResponse.json(
      {
        ok: false,
        checked: result.checked,
        brokenAt: result.brokenAt,
        message:
          'The admin audit chain does not verify. An entry was edited, inserted or removed. ' +
          'Treat every admin action record as untrusted until this is explained.',
        requestId: ctx.requestId,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    checked: result.checked,
    durationMs,
    requestId: ctx.requestId,
  })
})
