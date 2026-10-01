/**
 * A security control an operator cannot satisfy is an outage, not a control.
 *
 * 🐛 2026-10-01. Rahul, logged in as founder: "i am not able to upgrade the
 * user to elite." The user detail page said "User not found" for a user one
 * click away in the list; the Admin Team page said "Only founders can manage
 * the admin team" — to a founder.
 *
 * Neither was true. Since 2026-07-27, 24 routes demand a fresh authenticator
 * code (`stepUp: true`). The server refuses with STEP_UP_REQUIRED and points at
 * an API address, because no screen existed to ask for the code. Every one of
 * those features was unreachable for every operator.
 *
 * The existing step-up tests proved the SERVER refuses correctly. Not one asked
 * whether anyone could get past the refusal. Same miss as the invoice designs
 * in the main app: the registry was tested, the path to it was not.
 *
 * Every rule here runs against inputs the test owns — a fake fetch returning a
 * known-good or a known-bad response — so each is proved both ways
 * (CLAUDE.md, Cause 7).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  isStepUpRefusal,
  shouldIntercept,
  withStepUp,
  STEP_UP_CODE,
} from '@/lib/step-up-client'
import {
  ROUTE_POLICY,
  ASSIGNABLE_ROLES,
  isAssignableRole,
  isRoleAllowed,
} from '@/lib/route-policy'

const ORIGIN = 'https://bahikhata-admin.vercel.app'
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const stepUpRefusal = () =>
  json(403, { error: { code: STEP_UP_CODE, message: 'needs a code', requestId: 'r1' } })
const roleRefusal = () =>
  json(403, { error: { code: 'FORBIDDEN', message: 'role cannot', requestId: 'r2' } })

/** A fake server: answers from a queue, records every call. */
function fakeFetch(...answers: Array<() => Response>) {
  const calls: string[] = []
  const f = (async (input: RequestInfo | URL) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const next = answers.shift()
    if (!next) throw new Error('fake server ran out of answers')
    return next()
  }) as typeof fetch
  return { f, calls }
}

describe('telling the step-up refusal apart from every other 403', () => {
  it('recognises STEP_UP_REQUIRED', async () => {
    expect(await isStepUpRefusal(stepUpRefusal())).toBe(true)
  })

  it('does NOT treat a role refusal as a prompt', async () => {
    // Asking a viewer for a code that can never unlock a founder-only route
    // would be a prompt that lies about what will happen.
    expect(await isStepUpRefusal(roleRefusal())).toBe(false)
    expect(await isStepUpRefusal(json(200, { ok: true }))).toBe(false)
    expect(await isStepUpRefusal(new Response('<html>', { status: 403 }))).toBe(false)
  })

  it('leaves the body readable for the caller', async () => {
    const res = stepUpRefusal()
    await isStepUpRefusal(res)
    expect((await res.json()).error.code).toBe(STEP_UP_CODE)
  })
})

describe('which requests may be intercepted', () => {
  it('our own admin API, relative or absolute', () => {
    expect(shouldIntercept('/api/admin/users/abc', ORIGIN)).toBe(true)
    expect(shouldIntercept(`${ORIGIN}/api/admin/admin-users?tab=list`, ORIGIN)).toBe(true)
  })

  it('never the step-up route itself, or it would ask for itself', () => {
    expect(shouldIntercept('/api/admin/step-up', ORIGIN)).toBe(false)
  })

  it('never another origin, and never a non-admin path', () => {
    // A replay to a third party carrying a freshly elevated session is the
    // one thing this wrapper must never do.
    expect(shouldIntercept('https://evil.example/api/admin/users', ORIGIN)).toBe(false)
    expect(shouldIntercept('/api/auth/session', ORIGIN)).toBe(false)
    expect(shouldIntercept('/users/abc', ORIGIN)).toBe(false)
  })
})

describe('the wrapper', () => {
  it('asks once, then retries and returns the SUCCESS', async () => {
    // The exact case Rahul hit: the plan change, refused for step-up.
    const { f, calls } = fakeFetch(stepUpRefusal, () => json(200, { user: { plan: 'elite' } }))
    let asked = 0
    const wrapped = withStepUp(f, async () => { asked++; return true }, ORIGIN)

    const res = await wrapped('/api/admin/users/u1', { method: 'PATCH', body: '{"plan":"elite"}' })

    expect({ asked, status: res.status, calls: calls.length }).toEqual({ asked: 1, status: 200, calls: 2 })
    expect((await res.json()).user.plan).toBe('elite')
  })

  it('on cancel, hands back the ORIGINAL refusal rather than inventing success', async () => {
    const { f, calls } = fakeFetch(stepUpRefusal)
    const wrapped = withStepUp(f, async () => false, ORIGIN)
    const res = await wrapped('/api/admin/users/u1')
    expect({ status: res.status, calls: calls.length }).toEqual({ status: 403, calls: 1 })
  })

  it('never prompts for a role refusal', async () => {
    const { f } = fakeFetch(roleRefusal)
    let asked = 0
    const wrapped = withStepUp(f, async () => { asked++; return true }, ORIGIN)
    const res = await wrapped('/api/admin/admin-users')
    expect({ asked, status: res.status }).toEqual({ asked: 0, status: 403 })
  })

  it('retries exactly once — a second refusal is returned, not looped on', async () => {
    const { f, calls } = fakeFetch(stepUpRefusal, stepUpRefusal)
    let asked = 0
    const wrapped = withStepUp(f, async () => { asked++; return true }, ORIGIN)
    const res = await wrapped('/api/admin/users/u1')
    expect({ asked, status: res.status, calls: calls.length }).toEqual({ asked: 1, status: 403, calls: 2 })
  })

  it('two refusals at once share ONE prompt', async () => {
    // The Admin Team page loads two step-up routes together. Two stacked code
    // boxes fighting for focus would be its own bug.
    const { f } = fakeFetch(stepUpRefusal, stepUpRefusal, () => json(200, {}), () => json(200, {}))
    let asked = 0
    let release!: (ok: boolean) => void
    const gate = new Promise<boolean>((r) => { release = r })
    const wrapped = withStepUp(f, () => { asked++; return gate }, ORIGIN)

    const both = Promise.all([wrapped('/api/admin/admin-users?tab=overview'), wrapped('/api/admin/admin-users?tab=list')])
    await new Promise((r) => setTimeout(r, 10))
    release(true)
    const [a, b] = await both
    expect({ asked, a: a.status, b: b.status }).toEqual({ asked: 1, a: 200, b: 200 })
  })

  it('a refusal arriving just AFTER a verified code retries without asking again', async () => {
    const { f } = fakeFetch(stepUpRefusal, () => json(200, {}), stepUpRefusal, () => json(200, {}))
    let asked = 0
    const wrapped = withStepUp(f, async () => { asked++; return true }, ORIGIN)
    await wrapped('/api/admin/users/u1')
    await wrapped('/api/admin/users/u2')
    expect(asked).toBe(1)
  })

  it('passes non-admin requests straight through, untouched', async () => {
    const { f, calls } = fakeFetch(stepUpRefusal)
    let asked = 0
    const wrapped = withStepUp(f, async () => { asked++; return true }, ORIGIN)
    const res = await wrapped('https://other.example/thing')
    expect({ asked, status: res.status, calls: calls.length }).toEqual({ asked: 0, status: 403, calls: 1 })
  })
})

describe('the prompt is actually mounted — a control nobody can reach is the bug', () => {
  it('the admin layout mounts the step-up provider', () => {
    const src = read('src/app/(admin)/layout.tsx')
    expect({ imports: src.includes("from '@/components/admin/step-up-provider'"), renders: src.includes('<StepUpProvider>') })
      .toEqual({ imports: true, renders: true })
  })

  it('every stepUp route sits under /api/admin/, so the provider can see it', () => {
    // If a stepUp route ever lives elsewhere the interceptor will not see it,
    // and that route is back to failing with no way through.
    const stepUpRoutes = Object.entries(ROUTE_POLICY).filter(([, p]) => p.stepUp).map(([k]) => k)
    expect(stepUpRoutes.length).toBeGreaterThan(0)
    const outside = stepUpRoutes.filter((k) => !shouldIntercept(`/api/${k.replace(/\[[^\]]+\]/g, 'x')}`, ORIGIN))
    expect(outside).toEqual([])
  })

  it('the user detail page no longer calls every failure "User not found"', () => {
    const src = read('src/app/(admin)/users/[id]/page.tsx')
    expect({ throwsOnError: src.includes('if (!r.ok) throw new Error(readApiError(body, r.status))') })
      .toEqual({ throwsOnError: true })
  })
})

describe('roles: one list, and no one-way doors', () => {
  it('every assignable role is one the permission table knows', () => {
    // The Admin Team screen offered "admin", which the table has never heard
    // of — so "Admin (full access)" meant no access at all.
    expect(isAssignableRole('admin')).toBe(false)
    expect(isAssignableRole('founder')).toBe(false)
    for (const r of ASSIGNABLE_ROLES) expect(isAssignableRole(r)).toBe(true)
  })

  it('each assignable role can reach SOMETHING — no role is a dead account', () => {
    const dead = ASSIGNABLE_ROLES.filter((r) =>
      !Object.values(ROUTE_POLICY).some((p) => isRoleAllowed(p, 'GET', r)))
    expect(dead).toEqual([])
    // And the retired "admin" really is dead — which is why it had to go.
    expect(Object.values(ROUTE_POLICY).some((p) => isRoleAllowed(p, 'GET', 'admin' as never))).toBe(false)
    for (const r of ['support', 'finance', 'analyst'] as const) {
      expect({ r, seesUsers: isRoleAllowed(ROUTE_POLICY['admin/users'], 'GET', r) }).toEqual({ r, seesUsers: true })
    }
  })

  it("a founder's role cannot be changed from the app — including by themselves", () => {
    // Founder can never be GRANTED from the app, so a self-demotion was
    // permanent. The guard must sit in the handler, before the update.
    const src = read('src/app/api/admin/admin-users/[id]/route.ts')
    const guard = src.indexOf("if (role !== undefined && existing.role === 'founder')")
    const update = src.indexOf('db.adminUser.update')
    expect({ guarded: guard > -1, beforeUpdate: guard > -1 && guard < update })
      .toEqual({ guarded: true, beforeUpdate: true })
  })

  it('neither route stores a role without checking it', () => {
    for (const p of ['src/app/api/admin/admin-users/route.ts', 'src/app/api/admin/admin-users/[id]/route.ts']) {
      const src = read(p)
      expect({ p, validates: src.includes('isAssignableRole(') }).toEqual({ p, validates: true })
      expect({ p, oldList: src.includes("['admin', 'viewer']") }).toEqual({ p, oldList: false })
    }
  })
})

describe('the two bugs only the browser found', () => {
  /*
   * Every unit test above passed while both of these were live. They were
   * found by loading the real pages on 2026-10-02 — which is the argument
   * for doing that every time, and the reason these exist.
   */
  it('the fetch wrapper is installed at RENDER, not in an effect', () => {
    // React runs a child's effects before its parent's. Installed in a
    // useEffect, the user detail page's request went out UNWRAPPED and the
    // code box never opened — the original bug, intact, behind a green suite.
    const src = read('src/components/admin/step-up-provider.tsx')
    const body = src.slice(src.indexOf('export function StepUpProvider'))
    // /\r?\n/ — a Windows checkout ends lines with \r\n (CLAUDE.md, Cause 7).
    const firstLine = body.split(/\r?\n/).slice(1).find((l) => l.trim().length > 0)?.trim()
    expect({ installsFirst: firstLine === 'ensureInstalled()' }).toEqual({ installsFirst: true })
    expect({ patchesInEffect: /useEffect\([\s\S]{0,300}window\.fetch\s*=/.test(src) })
      .toEqual({ patchesInEffect: false })
  })

  it('the Admin Team page keeps no role list of its own', () => {
    // A third hand-written list ("perms") had no entry for the real roles, so
    // adding them crashed the page — and it described "admin" as "access to
    // all admin pages", a role that could reach none. Every role word on the
    // page must come from route-policy.
    const src = read('src/app/(admin)/admin-users/page.tsx')
    expect({ usesShared: src.includes('ROLE_DESCRIPTIONS'), ownList: /const perms\s*=/.test(src) })
      .toEqual({ usesShared: true, ownList: false })
    for (const r of ASSIGNABLE_ROLES) {
      expect({ r, inRoleConfig: new RegExp(`\\b${r}: \\{ icon`).test(src) }).toEqual({ r, inRoleConfig: true })
    }
  })
})
