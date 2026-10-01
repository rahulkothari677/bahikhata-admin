/**
 * STEP-UP ON THE CLIENT — the half that was never built.
 *
 * 🐛 2026-10-01. Rahul: "i logged in from my admin account but i am not able to
 * upgrade the user to elite."
 *
 * The 2026-07-27 audit made the server ENFORCE step-up on 24 routes (see
 * ROUTE_POLICY, `stepUp: true`). Commit 552d31d (4 Aug) then added a /step-up
 * PAGE and made the refusal say "Open /step-up, enter the 6-digit code, then
 * retry". Both correct — and Rahul still could not get through, because the
 * pages that HIT the refusal never showed it:
 *
 *   · the user detail page rendered "User not found" for any non-user body
 *   · the plan change toasted "Failed to update plan"
 *   · the Admin Team page said "Only founders can manage the admin team" —
 *     to a founder, sending him looking for a demotion that had not happened
 *
 * So the message pointing at /step-up was written, and then thrown away one
 * layer up. A way in that the operator is never told about is not a way in.
 *
 * This file keeps the /step-up page and adds the obvious missing piece: ask
 * for the code AT THE MOMENT it is needed, in place, then carry on with what
 * the operator was doing. Same endpoint, same 10-minute grant.
 *
 * ── WHY ONE INTERCEPTOR AND NOT 24 PAGE FIXES ─────────────────────────
 *
 * Every admin page calls fetch() directly, 46+ call sites, and several check
 * `r.status === 403` themselves before any shared handler could see the
 * response. Fixing pages one at a time leaves the next new stepUp route broken
 * by default. Wrapping fetch once means a refusal is resolved before ANY page
 * sees it — and a route added tomorrow works on its first request.
 *
 * Pure functions over an injected fetch, so the behaviour is testable in node
 * against known-good and known-bad responses (CLAUDE.md, Cause 7).
 */

export const STEP_UP_CODE = 'STEP_UP_REQUIRED'

/** The endpoint that grants step-up. Never intercepted — it would ask for itself. */
export const STEP_UP_PATH = '/api/admin/step-up'

/**
 * Is this response the step-up refusal, as opposed to any other 403?
 *
 * Reads a CLONE: the caller may still need the body. Matches on the typed
 * code rather than the status, because a 403 also means "your role cannot do
 * this", and treating that as a prompt would ask a viewer for a code that can
 * never unlock a founder-only route.
 */
export async function isStepUpRefusal(res: Response): Promise<boolean> {
  if (res.status !== 403) return false
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } } | null
    return body?.error?.code === STEP_UP_CODE
  } catch {
    return false
  }
}

/**
 * Only our own admin API — never a third-party URL, never the step-up route.
 *
 * A request to another origin is not ours to retry, and must never be replayed
 * with an operator's freshly elevated session.
 */
export function shouldIntercept(url: string, origin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url, origin)
  } catch {
    return false
  }
  if (parsed.origin !== origin) return false
  if (!parsed.pathname.startsWith('/api/admin/')) return false
  if (parsed.pathname === STEP_UP_PATH || parsed.pathname.startsWith(STEP_UP_PATH + '/')) return false
  return true
}

/**
 * Wrap fetch so a step-up refusal asks for a code, then retries ONCE.
 *
 * `ask` resolves true when a code was verified, false when the operator
 * cancelled. On cancel the ORIGINAL refusal is returned, so the page can still
 * say what happened rather than see a fabricated success.
 *
 * Concurrent refusals share ONE prompt. A page that loads two step-up routes
 * at once must show one code box, not two stacked dialogs fighting for focus.
 *
 * Retries exactly once. If the retry is refused again (a clock-skewed device,
 * a grant revoked in between) that answer is returned as it is — a loop here
 * would re-prompt forever on a fault no code can fix.
 */
export function withStepUp(
  baseFetch: typeof fetch,
  ask: () => Promise<boolean>,
  origin: string,
): typeof fetch {
  let pending: Promise<boolean> | null = null
  /*
   * When a code was last verified. A request sent BEFORE the operator typed
   * the code can have its refusal arrive AFTER the box closed; without this
   * it would open a second prompt for a grant that already exists.
   */
  let lastVerifiedAt = 0
  const RECENT_MS = 5_000

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!shouldIntercept(url, origin)) return baseFetch(input, init)

    // A Request body can be read once. Keep a copy for the retry BEFORE the
    // first send consumes it. String and URL inputs carry no body of their own;
    // `init.body` is a string at every call site in this app.
    const retryInput = input instanceof Request ? input.clone() : input

    const res = await baseFetch(input, init)
    if (!(await isStepUpRefusal(res))) return res

    if (Date.now() - lastVerifiedAt < RECENT_MS) return baseFetch(retryInput, init)

    pending ??= ask()
      .then((ok) => {
        if (ok) lastVerifiedAt = Date.now()
        return ok
      })
      .finally(() => {
        pending = null
      })
    const verified = await pending
    if (!verified) return res
    return baseFetch(retryInput, init)
  }
}
