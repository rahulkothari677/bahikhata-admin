'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shield, Loader2, AlertCircle, KeyRound, Eye, EyeOff } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  // 🐛 FIX (admin-login-fix-phase-1): Show a success banner when bounced back
  // from /setup-2fa after a successful 2FA enrollment, OR a notice when the
  // grace session expired.
  const message = searchParams.get('message')
  const graceExpired = searchParams.get('error') === 'grace_expired'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [show2FA, setShow2FA] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const result = await signIn('credentials', {
      email,
      password,
      totpCode: show2FA ? totpCode : undefined,
      redirect: false,
    })

    if (result?.error) {
      if (result.error === '2FA_REQUIRED') {
        setShow2FA(true)
        setError('Enter your 2FA code from Google Authenticator')
      } else if (result.error === 'CredentialsSignin') {
        // 🐛 FIX (admin-login-fix-phase-1): The previous code called a
        // /api/admin/login-debug endpoint that was DELETED in the V26 audit
        // (security: it was an unauthenticated info-leak oracle that told
        // attackers WHY a login failed — "wrong password" vs "email not in
        // whitelist"). We now show a single generic message — same security
        // posture as the rest of the codebase. The specific reason is still
        // logged server-side in src/lib/auth.ts for admin debugging.
        setError('Invalid email or password. Only founder emails can access.')
      } else {
        setError(result.error)
      }
      setLoading(false)
    } else if (result?.ok) {
      // 🐛 FIX (admin-login-fix-phase-1): After a grace login (no 2FA set up
      // yet), the server returns ok=true with a session that has
      // requires2FASetup=true. We can't read that flag here from the signIn
      // result, so we let the normal callbackUrl redirect happen — the
      // middleware will intercept the request to /  and bounce the user to
      // /setup-2fa. So we just push to callbackUrl and let middleware route
      // them correctly.
      router.push(callbackUrl)
      router.refresh()
    } else {
      setError('Login failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">BahiKhata Pro — Admin Access Only</p>
        </div>

        {/* Security notice */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-6">
          <p className="text-xs text-amber-200 text-center">
            🔒 Authorized personnel only. All access is logged.
          </p>
        </div>

        {/* 🐛 FIX (admin-login-fix-phase-1): Success banner after 2FA enrollment */}
        {message === '2fa_enabled' && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-200">
              <strong>2FA enabled!</strong> Log in again with your email, password, and the 6-digit
              code from your authenticator app.
            </p>
          </div>
        )}

        {/* 🐛 FIX (admin-login-fix-phase-1): Notice when grace session expired */}
        {graceExpired && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200">
              Your 2FA-setup window expired (10-minute limit). Please log in again to resume.
            </p>
          </div>
        )}

        {/* Login form */}
        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loading}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              placeholder="admin@bahikhata.pro"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {show2FA && (
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1.5">
                <span className="flex items-center gap-1">
                  <KeyRound className="w-3 h-3" />
                  2FA Code
                </span>
              </label>
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                disabled={loading}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-center tracking-[0.5em] font-mono"
                placeholder="000000"
                maxLength={6}
              />
              <p className="text-[10px] text-slate-400 mt-1">Enter the 6-digit code from your authenticator app</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : show2FA ? (
              'Verify & Sign In'
            ) : (
              'Access Dashboard'
            )}
          </button>

          {/* Forgot password link */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => router.push('/forgot-password')}
              className="text-xs text-amber-400 hover:text-amber-300 transition"
            >
              Forgot password?
            </button>
          </div>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-6">
          Session expires in 1 hour for security
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
