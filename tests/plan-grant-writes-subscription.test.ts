/**
 * A plan change must grant the plan — not just say it did.
 *
 * The main app's getUserPlan() treats `user.plan` as a CLAIM: for 'pro' and
 * 'elite' it requires an active, unexpired Subscription row and returns 'free'
 * without one. So setting `user.plan` alone is a cosmetic upgrade.
 *
 * History, because it is why this file now tests what it tests:
 *
 *  · fa17955 found bulk "change plan" upgrading nobody, and fixed it INSIDE the
 *    bulk handler. This file then read the bulk route's source text.
 *  · 2026-10-02: the single-user upgrade on the user detail page — the button
 *    Rahul was using to make a user elite — had the identical bug and kept it.
 *    A text check on one file could never see a second file with the same
 *    mistake. Two copies of one rule; one corrected; the guard watched one.
 *
 * Now the rule is ONE function (lib/plan-grant) and this file:
 *   1. runs it against a fake transaction and checks what it WRITES —
 *      behaviour, proved both ways, not text that happens to be nearby;
 *   2. requires every route that changes a plan to go through it, so a third
 *      copy cannot appear without failing here.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { applyPlanGrant, type PlanGrantTx } from '@/lib/plan-grant'

/** A fake transaction that records every write. */
function fakeTx() {
  const writes: Array<{ model: string; op: string; args: any }> = []
  const rec = (model: string, op: string) => async (args: any) => {
    writes.push({ model, op, args })
    return { count: Array.isArray(args?.data) ? args.data.length : 1 }
  }
  const tx: PlanGrantTx = {
    user: { updateMany: rec('user', 'updateMany') },
    subscription: {
      updateMany: rec('subscription', 'updateMany'),
      createMany: rec('subscription', 'createMany'),
    },
  }
  return { tx, writes }
}

const NOW = new Date('2026-10-02T10:00:00Z')

describe('the rule: what a grant actually writes', () => {
  it('an upgrade to elite writes the Subscription the main app checks for', async () => {
    const { tx, writes } = fakeTx()
    await applyPlanGrant(tx, { userIds: ['u1'], plan: 'elite', now: NOW, source: 'admin' })

    const created = writes.find((w) => w.model === 'subscription' && w.op === 'createMany')
    expect(created, 'no Subscription row — the upgrade would be cosmetic').toBeDefined()
    const row = created!.args.data[0]
    expect({ userId: row.userId, plan: row.plan, status: row.status, paymentMode: row.paymentMode })
      .toEqual({ userId: 'u1', plan: 'elite', status: 'active', paymentMode: 'admin_grant' })
    // Unexpired: getUserPlan rejects a subscription whose endDate has passed.
    expect(row.endDate.getTime()).toBeGreaterThan(NOW.getTime())
    // Subscription.id has no DB default.
    expect(row.id).toMatch(/^admin_u1_\d+$/)
  })

  it('the user row and the subscription agree on plan and end date', async () => {
    const { tx, writes } = fakeTx()
    await applyPlanGrant(tx, { userIds: ['u1'], plan: 'pro', now: NOW, source: 'admin' })
    const user = writes.find((w) => w.model === 'user')!.args.data
    const sub = writes.find((w) => w.op === 'createMany')!.args.data[0]
    expect({ plan: user.plan, end: user.renewsAt.getTime() })
      .toEqual({ plan: sub.plan, end: sub.endDate.getTime() })
  })

  it('an explicit end date is honoured on both', async () => {
    const end = new Date('2027-01-01T00:00:00Z')
    const { tx, writes } = fakeTx()
    await applyPlanGrant(tx, { userIds: ['u1'], plan: 'elite', endDate: end, now: NOW, source: 'admin' })
    expect(writes.find((w) => w.model === 'user')!.args.data.renewsAt).toEqual(end)
    expect(writes.find((w) => w.op === 'createMany')!.args.data[0].endDate).toEqual(end)
  })

  it('supersedes previous grants BEFORE creating the new one', async () => {
    // Otherwise a pro row and an elite row are both "active", and which one
    // the main app finds first decides the user's plan.
    const { tx, writes } = fakeTx()
    await applyPlanGrant(tx, { userIds: ['u1'], plan: 'elite', now: NOW, source: 'admin' })
    const expire = writes.findIndex((w) => w.model === 'subscription' && w.op === 'updateMany')
    const create = writes.findIndex((w) => w.op === 'createMany')
    expect(expire).toBeGreaterThan(-1)
    expect(writes[expire].args.data.status).toBe('expired')
    expect(expire).toBeLessThan(create)
  })

  it('a downgrade to free expires active rows and creates none', async () => {
    const { tx, writes } = fakeTx()
    await applyPlanGrant(tx, { userIds: ['u1'], plan: 'free', now: NOW, source: 'admin' })
    expect(writes.some((w) => w.op === 'createMany')).toBe(false)
    expect(writes.some((w) => w.model === 'subscription' && w.op === 'updateMany')).toBe(true)
    expect(writes.find((w) => w.model === 'user')!.args.data.renewsAt).toBeNull()
  })

  it("revokes the user's existing session so the new plan applies at once", async () => {
    const { tx, writes } = fakeTx()
    await applyPlanGrant(tx, { userIds: ['u1'], plan: 'elite', now: NOW, source: 'admin' })
    expect(writes.find((w) => w.model === 'user')!.args.data.tokenVersion).toEqual({ increment: 1 })
  })
})

describe('every route that changes a plan uses the rule', () => {
  const ROOT = path.resolve(__dirname, '..')
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // Every route file under src/app/api that writes `plan` onto a user.
  function planWriters(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'route.ts') {
          const src = strip(fs.readFileSync(p, 'utf8'))
          if (/applyPlanGrant\(|user\.(update|updateMany)\(\{[\s\S]{0,400}?\bplan\b\s*[:,]/.test(src)) {
            out.push(path.relative(ROOT, p).replace(/\\/g, '/'))
          }
        }
      }
    }
    walk(path.join(ROOT, 'src/app/api'))
    return out.sort()
  }

  it('finds both known plan-changing routes — the search is not vacuous', () => {
    const found = planWriters()
    expect(found).toContain('src/app/api/admin/bulk/route.ts')
    expect(found).toContain('src/app/api/admin/users/[id]/route.ts')
  })

  it('none of them writes a plan without the rule', () => {
    // The class, not the instance: a third route setting user.plan by hand
    // fails here the day it is written.
    const offenders = planWriters().filter((f) => !strip(read(f)).includes('applyPlanGrant('))
    expect(offenders).toEqual([])
  })

  it('each calls it inside a transaction — a half-applied grant is the bug', () => {
    for (const f of ['src/app/api/admin/bulk/route.ts', 'src/app/api/admin/users/[id]/route.ts']) {
      const src = strip(read(f))
      const tx = src.indexOf('db.$transaction(async (tx)')
      const call = src.indexOf('applyPlanGrant(tx')
      expect({ f, inTransaction: tx > -1 && call > tx }).toEqual({ f, inTransaction: true })
    }
  })
})
