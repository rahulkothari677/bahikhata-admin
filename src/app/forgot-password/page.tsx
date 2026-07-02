'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Loader2, AlertCircle, CheckCircle2, KeyRound, Eye, EyeOff } from 'lucide-react'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'reset' | 'success'>('email')
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetToken, setResetToken] = useState('')

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const r = await fetch('/api/admin/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await r.json()

      if (!r.ok) {
        setError(data.error || data.reason || 'Failed to process request')
      } else {
        // For security, in production this would email a link.
        // For now, we show the reset token directly (dev mode).
        setResetToken(data.resetToken)
        setStep('reset')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters')
      setLoading(false)
      return
    }

    try {
      const r = await fetch('/api/admin/forgot-password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resetToken, newPassword }),
      })
      const data = await r.json()

      if (!r.ok) {
        setError(data.error || 'Failed to reset password')
      } else {
        setStep('success')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {step === 'email' && 'Forgot Password'}
            {step === 'reset' && 'Reset Password'}
            {step === 'success' && 'Password Reset'}
          </h1>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 space-y-4">
            <p className="text-sm text-slate-400">Enter your admin email to receive a password reset link.</p>
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                placeholder="admin@bahikhata.pro"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Send Reset Link
            </button>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="w-full text-xs text-slate-400 hover:text-white transition"
            >
              ← Back to login
            </button>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={handleResetSubmit} className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 space-y-4">
            <p className="text-sm text-slate-400">
              A reset token has been generated. Enter your new password below.
            </p>
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1.5">New Password (min 12 chars)</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={12}
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-white text-sm focus:outline-none focus:border-amber-500"
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || newPassword.length < 12}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Reset Password
            </button>
          </form>
        )}

        {step === 'success' && (
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-white font-medium mb-1">Password reset successfully!</p>
            <p className="text-sm text-slate-400 mb-4">You can now log in with your new password.</p>
            <button
              onClick={() => router.push('/login')}
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              Go to Login →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
