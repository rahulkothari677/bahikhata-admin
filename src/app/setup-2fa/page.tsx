'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  Shield,
  Loader2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Smartphone,
  Copy,
  LogOut,
  RefreshCw,
} from 'lucide-react'

/**
 * Setup-2FA page — shown when an admin logs in with valid email+password
 * but hasn't set up TOTP 2FA yet (grace session).
 *
 * 🐛 FIX (admin-login-fix-phase-1): Before this page existed, the V9 Phase B
 * "mandatory 2FA" enforcement threw 2FA_SETUP_REQUIRED on login and locked
 * the user out completely — they couldn't reach /settings to set up 2FA
 * because login itself was rejected. This page is the only thing a grace
 * session can access (enforced in middleware.ts via requires2FASetup flag).
 *
 * Flow:
 *   1. On mount, fetch /api/admin/2fa (GET) → generates new TOTP secret + QR
 *   2. User scans QR in Google Authenticator / Authy / 1Password
 *   3. User enters 6-digit code
 *   4. POST /api/admin/2fa with the code → verifies + sets totpEnabled=true
 *   5. Sign out + redirect to /login → user logs in again, now WITH 2FA
 *
 * Grace session has a 10-minute TTL (enforced in middleware). If it expires,
 * we show an "expired" banner and prompt re-login.
 */
export default function Setup2FAPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [secret, setSecret] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)

  const codeInputRef = useRef<HTMLInputElement>(null)

  // Fetch the TOTP secret + QR code on mount
  useEffect(() => {
    if (status !== 'authenticated') return

    // The grace session gives us access to /api/admin/2fa (allowlisted in middleware).
    void fetchSetup()
  }, [status])

  async function fetchSetup() {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/admin/2fa')
      const data = await r.json()
      if (!r.ok) {
        throw new Error(data.error || 'Failed to generate 2FA secret')
      }
      if (data.enabled) {
        // Already enabled (shouldn't happen in grace flow, but be safe).
        // Force sign-out + re-login.
        setSuccess(true)
        setTimeout(() => {
          void signOut({ callbackUrl: '/login' })
        }, 1500)
        return
      }
      setSecret(data.secret || '')
      setQrCodeUrl(data.qrCodeUrl || '')
      setOtpauthUrl(data.otpauthUrl || '')
      // Autofocus the code input after QR is shown
      setTimeout(() => codeInputRef.current?.focus(), 200)
    } catch (err: any) {
      setError(err.message || 'Failed to start 2FA setup')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch('/api/admin/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await r.json()
      if (!r.ok) {
        throw new Error(data.error || 'Verification failed')
      }
      setSuccess(true)
      // Give the user 2.5s to read the success message, then sign out and
      // bounce to /login. They MUST re-authenticate now with their new TOTP
      // code — the grace session is no longer valid for anything else.
      setTimeout(() => {
        void signOut({ callbackUrl: '/login?message=2fa_enabled' })
      }, 2500)
    } catch (err: any) {
      setError(err.message || 'Verification failed')
      setCode('')
      setTimeout(() => codeInputRef.current?.focus(), 50)
    } finally {
      setSubmitting(false)
    }
  }

  function copySecret() {
    if (!secret) return
    void navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Loading state — checking session
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    )
  }

  // Not authenticated — middleware should have redirected, but guard anyway
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <div className="text-center">
          <Shield className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <p className="text-white mb-4">You must log in first</p>
          <a href="/login" className="text-amber-500 hover:underline">Go to login →</a>
        </div>
      </div>
    )
  }

  // Sanity check: a non-grace session shouldn't be here. If 2FA is already
  // set up, redirect to /.
  const requires2FASetup = (session?.user as any)?.requires2FASetup === true
  if (!requires2FASetup && !success) {
    // Already set up — bounce to dashboard
    if (typeof window !== 'undefined') {
      window.location.href = '/'
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 py-10">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 mb-4 shadow-lg">
            <KeyRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Set Up Two-Factor Authentication</h1>
          <p className="text-sm text-slate-400 mt-1">
            2FA is mandatory for all admin accounts. You have a one-time 10-minute window to set it up.
          </p>
        </div>

        {/* Why am I seeing this? explainer */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-6">
          <p className="text-xs text-blue-200">
            <strong>Why am I seeing this?</strong> Your account doesn&apos;t have 2FA configured yet.
            You logged in with valid credentials, but you can&apos;t access the admin dashboard until
            2FA is enabled. This is a security requirement.
          </p>
        </div>

        {/* Success state — 2FA verified, signing out */}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-white font-medium mb-1">2FA enabled successfully!</p>
            <p className="text-sm text-slate-400 mb-4">
              Signing you out now — please log in again with your email, password, and the 6-digit
              code from your authenticator app.
            </p>
            <Loader2 className="w-5 h-5 animate-spin text-amber-500 mx-auto" />
          </div>
        )}

        {/* Main setup card — hidden once success is shown */}
        {!success && (
          <>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              </div>
            ) : (
              <>
                {/* Step 1: Scan QR */}
                <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 mb-4">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-500 text-white text-sm font-bold flex items-center justify-center">
                      1
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-white">Scan the QR code</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Use Google Authenticator, Authy, 1Password, or any TOTP app.
                      </p>
                    </div>
                  </div>

                  {qrCodeUrl && (
                    <div className="flex flex-col items-center gap-3">
                      {/* QR code is fetched from a public QR generator. The TOTP secret
                          itself is sensitive, but the otpauth URL embedded in the QR is
                          only useful together with the user's account. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrCodeUrl}
                        alt="2FA QR code"
                        width={200}
                        height={200}
                        className="rounded-lg bg-white p-2"
                      />
                      <details className="text-xs text-slate-400 w-full">
                        <summary className="cursor-pointer hover:text-slate-300">
                          Can&apos;t scan? Enter the secret manually
                        </summary>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="flex-1 bg-slate-900 px-3 py-2 rounded font-mono text-amber-300 break-all">
                            {secret}
                          </code>
                          <button
                            type="button"
                            onClick={copySecret}
                            className="flex-shrink-0 p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                            title="Copy secret"
                          >
                            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="mt-2 text-[11px]">
                          Account name: <span className="text-slate-300">{(session?.user as any)?.email}</span>
                          <br />
                          Type: Time-based (TOTP), 6 digits, 30-second interval
                        </p>
                      </details>
                    </div>
                  )}
                </div>

                {/* Step 2: Enter code */}
                <form onSubmit={handleVerify} className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 mb-4">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-500 text-white text-sm font-bold flex items-center justify-center">
                      2
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-white">Enter the 6-digit code</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        From your authenticator app, enter the current code.
                      </p>
                    </div>
                  </div>

                  <input
                    ref={codeInputRef}
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    disabled={submitting}
                    className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-3 text-white text-2xl text-center tracking-[0.5em] font-mono focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    placeholder="000000"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />

                  <button
                    type="submit"
                    disabled={submitting || code.length !== 6}
                    className="w-full mt-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Enable 2FA
                      </>
                    )}
                  </button>
                </form>

                {/* Footer actions */}
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => void fetchSetup()}
                    className="text-slate-400 hover:text-slate-300 transition flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Regenerate QR
                  </button>
                  <button
                    type="button"
                    onClick={() => void signOut({ callbackUrl: '/login' })}
                    className="text-slate-400 hover:text-slate-300 transition flex items-center gap-1"
                  >
                    <LogOut className="w-3 h-3" />
                    Sign out
                  </button>
                </div>

                {/* Mobile-app hints */}
                <div className="mt-6 bg-slate-900/50 border border-white/5 rounded-lg p-3">
                  <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                    <Smartphone className="w-3 h-3" />
                    Don&apos;t have an authenticator app?
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                    <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" target="_blank" rel="noreferrer" className="hover:text-amber-400">
                      Google Auth (Android)
                    </a>
                    <a href="https://apps.apple.com/app/google-authenticator/id388497605" target="_blank" rel="noreferrer" className="hover:text-amber-400">
                      Google Auth (iOS)
                    </a>
                    <a href="https://authy.com/download/" target="_blank" rel="noreferrer" className="hover:text-amber-400">
                      Authy (any)
                    </a>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
