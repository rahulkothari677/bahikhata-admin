'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck, Loader2, X } from 'lucide-react'
import { withStepUp, STEP_UP_PATH } from '@/lib/step-up-client'
import { readApiError } from '@/lib/read-api-error'

/**
 * The front door for step-up — the screen the server has pointed at since
 * 2026-07-27 and nobody built.
 *
 * 🐛 2026-10-01: 24 routes demanded a fresh authenticator code and no page
 * could ask for one, so user detail, plan changes, the Admin Team page,
 * impersonation, exports and the SQL console failed for every operator. See
 * lib/step-up-client.ts for the full account.
 *
 * Mounted once, in the admin layout. It wraps window.fetch so that ANY admin
 * request refused with STEP_UP_REQUIRED opens this box, verifies the code, and
 * retries what the operator was doing — the page never sees the refusal.
 *
 * Deliberately NOT a "remember this device" or a longer window. The grant
 * stays at the server's 10 minutes; this only removes the dead end.
 */
/*
 * 🐛 Found in the browser on 2026-10-02, after every unit test passed.
 *
 * This first installed the fetch wrapper in a useEffect. React runs a
 * CHILD's effects before its parent's — so the user detail page, a child of
 * this provider, sent its request through the UNWRAPPED fetch, got the
 * refusal, and the code box never opened. The tests exercised withStepUp()
 * directly and could not see React's ordering; only loading the page could.
 *
 * So it is installed at the first RENDER of the provider, which happens
 * before any child renders, let alone runs an effect. Once per page load,
 * guarded on window so a hot reload cannot wrap the wrapper.
 *
 * `currentAsk` is set in an effect, and that is safe where the install was
 * not: it is only CALLED once a server reply has come back, and replies arrive
 * on a later task than the commit that runs effects. If one ever did beat it,
 * the wrapper waits a tick rather than refusing the operator.
 */
type StepUpWindow = Window & { __stepUpRawFetch?: typeof fetch }
let currentAsk: (() => Promise<boolean>) | null = null

function ensureInstalled() {
  if (typeof window === 'undefined') return
  const w = window as StepUpWindow
  if (w.__stepUpRawFetch) return
  const original = window.fetch.bind(window)
  w.__stepUpRawFetch = original
  window.fetch = withStepUp(
    original,
    () =>
      currentAsk
        ? currentAsk()
        : new Promise<void>((r) => setTimeout(r, 0)).then(() => (currentAsk ? currentAsk() : false)),
    window.location.origin,
  )
}

export function StepUpProvider({ children }: { children: React.ReactNode }) {
  ensureInstalled()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve
        setCode('')
        setError(null)
        setOpen(true)
      }),
    [],
  )

  useEffect(() => {
    currentAsk = ask
    return () => {
      if (currentAsk === ask) currentAsk = null
    }
  }, [ask])

  const finish = (ok: boolean) => {
    setOpen(false)
    setBusy(false)
    resolver.current?.(ok)
    resolver.current = null
  }

  const submit = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // The UNWRAPPED fetch for the verification itself. The interceptor
      // already skips this path; using the original as well means a future
      // change to that rule cannot make the box ask for itself.
      const raw = (window as StepUpWindow).__stepUpRawFetch ?? fetch
      const r = await raw(STEP_UP_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totpCode: code }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        // INVALID_CODE, TOO_MANY_ATTEMPTS and TOTP_NOT_CONFIGURED all carry a
        // message written for the operator — show it as the server wrote it.
        setError(readApiError(data, r.status))
        setBusy(false)
        setCode('')
        return
      }
      finish(true)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="step-up-title"
        >
          <div
            className="relative rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm"
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <h2 id="step-up-title" className="text-base font-bold">Confirm it&apos;s you</h2>
              </div>
              <button
                onClick={() => finish(false)}
                aria-label="Cancel"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              className="p-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <p className="text-sm text-slate-600">
                This action changes or reveals sensitive data. Enter the 6-digit code from your
                authenticator app. It stays unlocked for 10 minutes.
              </p>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                aria-label="Authenticator code"
                className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-center text-lg tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => finish(false)}
                  className="flex-1 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Verify
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
