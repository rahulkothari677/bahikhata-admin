'use client'

/**
 * Step-up verification screen.
 *
 * 🔒 2026-08-04 (Phase 7 audit). ROUTE_POLICY marks 11 routes `stepUp: true` —
 * impersonation, data exports, the SQL console, admin-user management, bulk
 * operations. The server enforces it correctly: a request without a fresh
 * grant gets 403 STEP_UP_REQUIRED with the message
 *
 *     "This action needs your authenticator code. Verify at
 *      /api/admin/step-up and retry."
 *
 * There was nowhere to do that. No page, no dialog, and no UI anywhere handled
 * the STEP_UP_REQUIRED code — the message was shown in a toast and that was the
 * end of it. /api/admin/step-up accepts a POST with a JSON body, which is not
 * something an operator can do from a browser address bar.
 *
 * So eleven admin features were gated behind a control that could not be
 * satisfied. The security half was built and the operator half was not, which
 * is the same shape as the audit chain nothing verified and the lint step that
 * ran a removed command.
 *
 * This is the operator half. Verify once, and every step-up route works for the
 * ten-minute window defined in lib/step-up.ts.
 */

import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react'
import { PageHeader, ContentCard } from '@/components/admin/ui'

interface Status {
  active: boolean
  remainingSeconds: number
}

export default function StepUpPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justVerified, setJustVerified] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/step-up', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setStatus({ active: !!d.active, remainingSeconds: d.remainingSeconds ?? 0 })
    } catch {
      /* leave status null — the form still works */
    }
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])

  // Tick the remaining time down so the operator can see the grant expiring
  // rather than discovering it mid-action.
  useEffect(() => {
    if (!status?.active) return
    const t = setInterval(() => {
      setStatus(s => {
        if (!s) return s
        const next = s.remainingSeconds - 1
        return next <= 0 ? { active: false, remainingSeconds: 0 } : { ...s, remainingSeconds: next }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [status?.active])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const r = await fetch('/api/admin/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totpCode: code }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setError(d?.error?.message || 'That code was not accepted. Try the current one from your app.')
        setCode('')
        return
      }
      setCode('')
      setJustVerified(true)
      await loadStatus()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader
        title="Security verification"
        description="Some actions need your authenticator code, even though you are already signed in."
      />

      <ContentCard title="Status">
        {status?.active ? (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
            <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-emerald-900 dark:text-emerald-400">Verified</p>
              <p className="text-sm text-emerald-800 dark:text-emerald-300">
                Expires in <span className="font-mono font-medium">{mmss(status.remainingSeconds)}</span>.
                Sensitive actions will work until then.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-400">Not verified</p>
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Impersonation, data exports, the SQL console, admin-user changes and bulk
                operations will be refused until you verify below.
              </p>
            </div>
          </div>
        )}
      </ContentCard>

      <div className="mt-6">
        <ContentCard title="Enter your authenticator code">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="totp" className="block text-sm font-medium mb-1.5">
                6-digit code
              </label>
              <input
                id="totp"
                name="totp"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-describedby="totp-help"
                className="w-full max-w-[12rem] px-3 py-2 rounded-lg border border-border bg-background font-mono text-lg tracking-[0.3em] text-center"
              />
              <p id="totp-help" className="text-xs text-muted-foreground mt-1.5">
                From the same authenticator app you used to sign in. The code changes every 30 seconds.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            {justVerified && !error && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                Verified. You can go back and retry what you were doing.
              </p>
            )}

            <button
              type="submit"
              disabled={code.length !== 6 || submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        </ContentCard>
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        The grant lasts 10 minutes and covers this browser session only. It proves you are
        at the keyboard now — being signed in is not the same thing, which is the point.
      </p>
    </div>
  )
}
