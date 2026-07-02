# Environment Variables Guide

## Admin Panel (`bahikhata-admin/.env.local`)

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `NEXTAUTH_SECRET` | Random secret for JWT signing (generate with `openssl rand -base64 32`) | `abc123...` |
| `NEXTAUTH_URL` | Admin panel URL | `https://admin.bahikhata.pro` |
| `FOUNDER_EMAILS` | Comma-separated emails allowed to create admin accounts | `rahulkothari677@gmail.com` |

### Optional (Security)

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_IP_ALLOWLIST` | Comma-separated IPs/CIDRs allowed to access admin | Empty (allow all) |

### Optional (Notification Providers)

| Variable | Description | Provider |
|----------|-------------|----------|
| `MSG91_AUTH_KEY` | MSG91 API key for SMS | MSG91 |
| `MSG91_SENDER_ID` | 6-char sender ID | `BAHKHT` |
| `MSG91_ROUTE` | SMS route (4=transactional, 1=promotional) | `4` |
| `RESEND_API_KEY` | Resend API key for Email | Resend |
| `EMAIL_FROM` | From email address | `BahiKhata Pro <onboarding@bahikhata.pro>` |
| `FCM_SERVER_KEY` | Firebase Cloud Messaging server key for Push | Firebase |

### Optional (AI Providers — for status page checks)

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GROQ_API_KEY` | Groq API key |

### Optional (Payments — for status page checks)

| Variable | Description |
|----------|-------------|
| `RAZORPAY_KEY_ID` | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret |

---

## Main App (`bahikhata-pro/.env.local`)

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Same Neon PostgreSQL as admin (shared DB) | `postgresql://...` |
| `NEXTAUTH_SECRET` | Random secret (DIFFERENT from admin!) | `xyz789...` |
| `NEXTAUTH_URL` | Main app URL | `https://bahikhata.pro` |

### AI Providers (at least one required)

| Variable | Where to get it |
|----------|----------------|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `VLM_API_KEY` | Legacy — use GEMINI_API_KEY instead |

### Payments

| Variable | Where to get it |
|----------|----------------|
| `RAZORPAY_KEY_ID` | https://dashboard.razorpay.com/app/keys |
| `RAZORPAY_KEY_SECRET` | Same as above |

### Monitoring

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | Sentry error tracking DSN |

### Founder (bypasses usage limits)

| Variable | Description |
|----------|-------------|
| `FOUNDER_EMAIL` | Email that bypasses AI usage limits (you) |

---

## Vercel Environment Variables

When deploying to Vercel, add env vars in:
**Settings → Environment Variables**

### Important Vercel Settings:
1. **Environment:** Select Production, Preview, and Development as needed
2. **Sensitive:** Mark secrets as "Sensitive" (masked in dashboard)
3. **Auto-deploy:** Connect GitHub repo → auto-deploy on push to `main`

---

## Generating Secrets

```bash
# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Generate a random token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Common Issues

| Issue | Cause | Solution |
|-------|-------|---------|
| Login fails | `NEXTAUTH_SECRET` missing or wrong | Set it in .env.local + Vercel env vars |
| "Table does not exist" | Schema not pushed to DB | Run `npx prisma db push` |
| Status page shows "degraded" | AI/Payment env vars not set | Add them (optional — just affects status display) |
| Notifications "skipped" | Provider env vars not set | Add MSG91_AUTH_KEY / RESEND_API_KEY / FCM_SERVER_KEY |
| CSRF error on mutations | Origin header mismatch | Ensure NEXTAUTH_URL matches deployed URL |
