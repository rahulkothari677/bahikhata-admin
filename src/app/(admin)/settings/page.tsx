'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Shield, Lock, Smartphone, Loader2, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'

export default function SettingsPage() {
  const [setupCode, setSetupCode] = useState('')
  const [disableCode, setDisableCode] = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-2fa'],
    queryFn: async () => {
      const r = await fetch('/api/admin/2fa')
      return r.json()
    },
  })

  const enableMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await fetch('/api/admin/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      return data
    },
    onSuccess: (data) => {
      sonnerToast.success(data.message)
      setSetupCode('')
      refetch()
    },
    onError: (err: Error) => sonnerToast.error(err.message),
  })

  const disableMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await fetch('/api/admin/2fa', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      return data
    },
    onSuccess: (data) => {
      sonnerToast.success(data.message)
      setDisableCode('')
      refetch()
    },
    onError: (err: Error) => sonnerToast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  const is2FAEnabled = data?.enabled

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-slate-700" />
          Account Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your admin account security</p>
      </div>

      {/* 2FA Status */}
      <div className={`rounded-xl border p-4 ${is2FAEnabled ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'}`}>
        <div className="flex items-center gap-3">
          {is2FAEnabled ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          ) : (
            <AlertCircle className="w-6 h-6 text-amber-500" />
          )}
          <div>
            <p className="text-sm font-medium">
              Two-Factor Authentication: {is2FAEnabled ? 'ENABLED' : 'NOT ENABLED'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {is2FAEnabled
                ? 'Your account is protected with TOTP 2FA. You need a code from your authenticator app to log in.'
                : 'Your account is at risk. Enable 2FA to require a code from Google Authenticator on every login.'}
            </p>
          </div>
        </div>
      </div>

      {/* Setup 2FA */}
      {!is2FAEnabled && data?.qrCodeUrl && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-blue-500" />
            Set Up 2FA
          </h2>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3 py-4">
            <img src={data.qrCodeUrl} alt="2FA QR Code" className="w-48 h-48 rounded-lg border" />
            <p className="text-xs text-muted-foreground">Scan with Google Authenticator, Authy, or 1Password</p>
          </div>

          {/* Manual entry */}
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Or enter manually:</p>
            <code className="text-xs font-mono break-all">{data.manualEntry}</code>
          </div>

          {/* Instructions */}
          <div className="space-y-1">
            {data.instructions?.map((step: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground">{step}</p>
            ))}
          </div>

          {/* Verify */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Enter 6-digit code to verify:</label>
            <div className="flex gap-2">
              <input
                value={setupCode}
                onChange={e => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={() => enableMutation.mutate(setupCode)}
                disabled={setupCode.length !== 6 || enableMutation.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {enableMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Verify & Enable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disable 2FA */}
      {is2FAEnabled && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-red-500" />
            Disable 2FA (Not Recommended)
          </h2>
          <p className="text-xs text-muted-foreground">
            Disabling 2FA reduces your account security. You will only need a password to log in.
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Enter current 2FA code to confirm:</label>
            <div className="flex gap-2">
              <input
                value={disableCode}
                onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-destructive"
              />
              <button
                onClick={() => disableMutation.mutate(disableCode)}
                disabled={disableCode.length !== 6 || disableMutation.isPending}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
              >
                Disable 2FA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security tips */}
      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <h3 className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">🔒 Security Best Practices</h3>
        <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1 ml-4 list-disc">
          <li>Use a unique password (not used on any other site)</li>
          <li>Enable 2FA with Google Authenticator or Authy</li>
          <li>Set ADMIN_IP_ALLOWLIST to restrict access to your IP</li>
          <li>Log out when not using the admin panel</li>
          <li>Never share your admin credentials</li>
          <li>Review the audit log regularly for suspicious activity</li>
        </ul>
      </div>
    </div>
  )
}
