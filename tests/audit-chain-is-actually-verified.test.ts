import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { ROUTE_POLICY } from '../src/lib/route-policy'

/**
 * The audit chain must actually be verified by something.
 *
 * WHY (audit 2026-08-04, Phase 7). The admin audit log is a hash chain: each
 * entry stores the hash of the one before it, so editing or removing a row
 * breaks every hash after it. `verifyAuditChain()` recomputes the chain and
 * names the first entry that does not match.
 *
 * It was written correctly. tests/audit-chain.test.ts proves the hash changes
 * if the actor, action, description, target or timestamp is edited, and that
 * content cannot be shifted between fields to forge a match. A script existed
 * at scripts/verify-audit-chain.ts.
 *
 * And it had ZERO callers. Not a route, not a workflow, not a test. Seven jobs
 * ran on the schedule — daily stats, anomaly detection, churn, revenue
 * recognition, fraud rules, bulk jobs, webhook delivery — and the one that
 * detects tampering with the record of who did what was not among them.
 *
 * A tamper-EVIDENT log that nobody ever inspects is not tamper-evident.
 * Tampering stays theoretically detectable and practically undetected, which is
 * worse than having no chain: the chain is the reason anyone trusts the log.
 *
 * This is the same shape as the `stepUp` flag that nothing read, the lint step
 * that ran a removed command, and the E2E job gated on an event that never
 * fires. The mechanism is never the problem. Wiring it up is.
 *
 * These tests assert the wiring, because the maths is already covered next door.
 */

const ROOT = path.resolve(__dirname, '..')
const CRON_YML = path.join(ROOT, '.github/workflows/admin-cron.yml')
const ROUTE = path.join(ROOT, 'src/app/api/admin/audit-chain/verify/route.ts')

function read(p: string): string {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
}

describe('verifyAuditChain has a caller', () => {
  it('is imported by a route — the regression is having none at all', () => {
    expect(fs.existsSync(ROUTE)).toBe(true)
    expect(read(ROUTE)).toMatch(/import \{ verifyAuditChain \} from '@\/lib\/audit'/)
    expect(read(ROUTE)).toMatch(/await verifyAuditChain\(\)/)
  })

  it('is registered in ROUTE_POLICY, or withAdmin fails it closed at runtime', () => {
    expect(ROUTE_POLICY['admin/audit-chain/verify']).toBeDefined()
  })

  it('is reachable by the scheduled job', () => {
    // Without cron:true the nightly run cannot authenticate and the job 403s
    // every night — a check that never runs, reintroduced in a new place.
    expect(ROUTE_POLICY['admin/audit-chain/verify'].cron).toBe(true)
  })

  it('is read-only — a verifier that can write to the chain proves nothing', () => {
    const src = read(ROUTE)
    expect(src).not.toMatch(/adminAction\.(update|updateMany|delete|deleteMany|create)\(/)
  })
})

describe('the scheduled job exists and fails loudly', () => {
  const yml = read(CRON_YML)

  it('has a cron entry and a job that runs on it', () => {
    expect(yml).toMatch(/- cron: '0 4 \* \* \*'/)
    expect(yml).toMatch(/verify-audit-chain:/)
    // The job's `if` must reference the same schedule, or it never triggers.
    expect(yml).toMatch(/github\.event\.schedule == '0 4 \* \* \*'/)
  })

  it('calls the verification endpoint', () => {
    expect(yml).toMatch(/api\/admin\/audit-chain\/verify/)
  })

  it('exits non-zero when the chain is broken', () => {
    // A job that logs the failure and exits 0 is the original bug wearing a
    // different hat: the check runs, and nobody hears about the answer.
    const job = yml.slice(yml.indexOf('verify-audit-chain:'))
    const block = job.slice(0, job.indexOf('# ===== FREQUENT JOBS'))
    expect(block).toMatch(/exit 1/)
  })
})

describe('the route reports a broken chain as a failure', () => {
  const src = read(ROUTE)

  it('returns a non-200 status when verification fails', () => {
    // The scheduled job decides by HTTP status. A 200 with { ok: false } would
    // be reported as success and the alert would never fire.
    expect(src).toMatch(/status: 500/)
  })

  it('records the break in the audit log itself', () => {
    expect(src).toMatch(/audit_chain_broken/)
  })

  it('does not write an entry on a clean run', () => {
    // A nightly "all fine" entry would bury the real ones in noise.
    const okBranch = src.slice(src.indexOf('return NextResponse.json({\n    ok: true'))
    expect(okBranch).not.toMatch(/ctx\.audit\(/)
  })
})
