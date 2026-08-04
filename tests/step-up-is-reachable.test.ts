import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { ROUTE_POLICY } from '../src/lib/route-policy'

/**
 * An operator must be able to satisfy step-up.
 *
 * WHY (audit 2026-08-04, Phase 7). ROUTE_POLICY marks 11 routes `stepUp: true`
 * — impersonation, data exports, the SQL console, admin-user management, bulk
 * operations. The server enforced it correctly and returned a clear 403:
 *
 *     "This action needs your authenticator code.
 *      Verify at /api/admin/step-up and retry."
 *
 * There was nowhere to do that. No page, no dialog, and nothing in the UI
 * handled the STEP_UP_REQUIRED code — the message reached a toast and stopped.
 * /api/admin/step-up is a POST taking a JSON body, which an operator cannot
 * issue from a browser.
 *
 * So eleven admin features were gated behind a control that could not be
 * satisfied. Not protected — unreachable. Confirmed live: the SQL console
 * returned STEP_UP_REQUIRED and there was no way to proceed.
 *
 * Same shape as the audit chain nothing verified, the lint step running a
 * removed command, and the E2E job gated on an event that never fires: the
 * mechanism was built, the other half was not.
 */

const ROOT = path.resolve(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const PAGE = 'src/app/(admin)/step-up/page.tsx'
const SIDEBAR = 'src/components/admin/admin-sidebar.tsx'
const WITH_ADMIN = 'src/lib/with-admin.ts'

describe('there is a way to perform step-up', () => {
  it('the page exists', () => {
    expect(fs.existsSync(path.join(ROOT, PAGE))).toBe(true)
  })

  it('it posts the code to the step-up endpoint', () => {
    const src = read(PAGE)
    expect(src).toMatch(/'\/api\/admin\/step-up'/)
    expect(src).toMatch(/method: 'POST'/)
    expect(src).toMatch(/totpCode/)
  })

  it('it reads current status, so an operator can see the grant expiring', () => {
    // Discovering the window has closed mid-action is the failure this avoids.
    expect(read(PAGE)).toMatch(/remainingSeconds/)
  })

  it('is reachable from the sidebar — a page nobody can find is the same bug again', () => {
    expect(read(SIDEBAR)).toMatch(/href: '\/step-up'/)
  })
})

describe('the refusal tells the operator where to go', () => {
  it('points at the page, not at the raw API endpoint', () => {
    const src = read(WITH_ADMIN)
    const msg = src.slice(src.indexOf("'STEP_UP_REQUIRED'"), src.indexOf("'STEP_UP_REQUIRED'") + 400)
    expect(msg).toMatch(/\/step-up/)
    // The old text sent people to a POST endpoint they could not call.
    expect(msg).not.toMatch(/Verify at \/api\/admin\/step-up/)
  })
})

describe('the routes this exists for', () => {
  it('still require step-up — the fix is a way IN, not a way around', () => {
    const gated = Object.entries(ROUTE_POLICY).filter(([, p]) => (p as { stepUp?: boolean }).stepUp)
    expect(gated.length).toBeGreaterThanOrEqual(11)

    // The most dangerous ones must stay gated.
    for (const key of ['admin/impersonate', 'admin/database/query']) {
      expect((ROUTE_POLICY[key] as { stepUp?: boolean }).stepUp).toBe(true)
    }
  })

  it('the step-up route itself does NOT require step-up', () => {
    // Requiring a fresh grant in order to obtain one is a deadlock: nobody
    // could ever verify, and all 11 features would stay unreachable.
    const policy = ROUTE_POLICY['admin/step-up'] as { stepUp?: boolean } | undefined
    expect(policy).toBeDefined()
    expect(policy?.stepUp).not.toBe(true)
  })
})
