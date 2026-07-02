/**
 * Notification Providers — Provider-agnostic send layer.
 *
 * Supported channels:
 *   - SMS: MSG91 (https://msg91.com) — set MSG91_AUTH_KEY env var
 *   - Email: Resend (https://resend.com) — set RESEND_API_KEY env var
 *   - Push: Firebase Cloud Messaging — set FCM_SERVER_KEY env var
 *
 * FALLBACK: If no provider env var is set, sends run in "dry-run" mode.
 * The notification is logged to NotificationLog with status="skipped" and
 * provider="dry-run". This lets you test the entire flow end-to-end
 * without spending money on SMS/Email/Push credits.
 *
 * To enable a real provider:
 *   1. Sign up for the provider (MSG91 / Resend / Firebase)
 *   2. Add the env var to .env.local (and Vercel env vars)
 *   3. Restart the server — the provider is auto-detected on next send
 */

export type Channel = 'sms' | 'email' | 'push'

export interface SendResult {
  success: boolean
  provider: string
  providerMessageId?: string
  error?: string
}

export interface SendParams {
  to: string                  // phone (SMS) | email (Email) | device token (Push)
  channel: Channel
  subject?: string            // email only
  body: string                // already-substituted body
}

// =====================================================================
// SMS — MSG91
// =====================================================================
// India's most popular SMS gateway. ₹0.20-0.30 per SMS.
// Get API key: https://msg91.com → Signup → API Keys
//
// Env: MSG91_AUTH_KEY
// Optional: MSG91_SENDER_ID (6-char alpha sender ID, default: BAHKHT)
// Optional: MSG91_ROUTE (4 = transactional, 1 = promotional, default: 4)
// =====================================================================
async function sendSms(params: SendParams): Promise<SendResult> {
  const authKey = process.env.MSG91_AUTH_KEY
  if (!authKey) {
    return {
      success: false,
      provider: 'dry-run',
      error: 'MSG91_AUTH_KEY not set — running in dry-run mode',
    }
  }

  const senderId = process.env.MSG91_SENDER_ID || 'BAHKHT'
  const route = process.env.MSG91_ROUTE || '4'

  try {
    // MSG91 API: https://docs.msg91.com/sms/send-sms
    const response = await fetch('https://api.msg91.com/api/v2/sendsms', {
      method: 'POST',
      headers: {
        'authkey': authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: senderId,
        route: route,
        country: '91', // India
        sms: [{
          message: params.body,
          to: [params.to.replace(/\D/g, '').slice(-10)], // last 10 digits
        }],
      }),
    })

    const data = await response.json()
    if (response.ok && data.type === 'success') {
      return {
        success: true,
        provider: 'msg91',
        providerMessageId: data.message || data._id,
      }
    }
    return {
      success: false,
      provider: 'msg91',
      error: data.message || `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      success: false,
      provider: 'msg91',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// =====================================================================
// EMAIL — Resend
// =====================================================================
// Modern email API (better deliverability than SendGrid).
// Free tier: 3,000 emails/month, 100/day.
// Get API key: https://resend.com → API Keys
//
// Env: RESEND_API_KEY
// Optional: EMAIL_FROM (default: onboarding@bahikhata.pro)
// =====================================================================
async function sendEmail(params: SendParams): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      success: false,
      provider: 'dry-run',
      error: 'RESEND_API_KEY not set — running in dry-run mode',
    }
  }

  const fromEmail = process.env.EMAIL_FROM || 'BahiKhata Pro <onboarding@bahikhata.pro>'

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.to],
        subject: params.subject || 'BahiKhata Pro',
        text: params.body,
      }),
    })

    const data = await response.json()
    if (response.ok && data.id) {
      return {
        success: true,
        provider: 'resend',
        providerMessageId: data.id,
      }
    }
    return {
      success: false,
      provider: 'resend',
      error: data.message || `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      success: false,
      provider: 'resend',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// =====================================================================
// PUSH — Firebase Cloud Messaging
// =====================================================================
// Free for unlimited pushes (Google pays for it).
// Get server key: https://console.firebase.google.com → Project →
// Project Settings → Cloud Messaging → Server Key
//
// Env: FCM_SERVER_KEY
// =====================================================================
async function sendPush(params: SendParams): Promise<SendResult> {
  const serverKey = process.env.FCM_SERVER_KEY
  if (!serverKey) {
    return {
      success: false,
      provider: 'dry-run',
      error: 'FCM_SERVER_KEY not set — running in dry-run mode',
    }
  }

  try {
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Authorization': `key=${serverKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: params.to,
        notification: {
          title: params.subject || 'BahiKhata Pro',
          body: params.body,
          sound: 'default',
        },
        data: {
          title: params.subject || 'BahiKhata Pro',
          body: params.body,
        },
      }),
    })

    const data = await response.json()
    if (response.ok && data.success === 1) {
      return {
        success: true,
        provider: 'fcm',
        providerMessageId: data.message_id,
      }
    }
    return {
      success: false,
      provider: 'fcm',
      error: data.error || `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      success: false,
      provider: 'fcm',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// =====================================================================
// MAIN DISPATCHER
// =====================================================================
export async function sendNotification(params: SendParams): Promise<SendResult> {
  switch (params.channel) {
    case 'sms':
      return sendSms(params)
    case 'email':
      return sendEmail(params)
    case 'push':
      return sendPush(params)
    default:
      return {
        success: false,
        provider: 'unknown',
        error: `Unknown channel: ${params.channel}`,
      }
  }
}

// =====================================================================
// VARIABLE SUBSTITUTION
// =====================================================================
// Replaces {{variableName}} in a template body with actual values.
// Missing variables are left as-is (so admin can see what wasn't substituted).
// =====================================================================
export function substituteVariables(
  body: string,
  variables: Record<string, string>
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
    return variables[varName] !== undefined ? variables[varName] : match
  })
}

// =====================================================================
// PROVIDER STATUS (for UI display)
// =====================================================================
// Returns which providers are configured (env vars set).
// Used by the UI to show "MSG91: ✓ Configured" or "MSG91: ✗ Not set".
// =====================================================================
export function getProviderStatus(): Record<Channel, { configured: boolean; provider: string | null }> {
  return {
    sms: {
      configured: !!process.env.MSG91_AUTH_KEY,
      provider: process.env.MSG91_AUTH_KEY ? 'MSG91' : null,
    },
    email: {
      configured: !!process.env.RESEND_API_KEY,
      provider: process.env.RESEND_API_KEY ? 'Resend' : null,
    },
    push: {
      configured: !!process.env.FCM_SERVER_KEY,
      provider: process.env.FCM_SERVER_KEY ? 'Firebase' : null,
    },
  }
}
