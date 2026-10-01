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
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)
  // The UNWRAPPED fetch, for the verification call itself. The interceptor
  // already skips the step-up path; using the original as well means a future
  // change to that rule cannot make the box ask for itself.
  const rawFetch = useRef<typeof fetch | null>(null)

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
    const original = window.fetch
    rawFetch.current = original.bind(window)
    window.fetch = withStepUp(original.bind(window), ask, window.location.origin)
    return () => {
      window.fetch = original
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
      const r = await (rawFetch.current ?? fetch)(STEP_UP_PATH, {
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
