# Phase 2 (2/22) — Multi-channel Notifications

**Page URL:** `/notifications`
**Sidebar location:** Engagement group → Send Notifications (send icon)
**Commit:** `355b5a2`

## What This Feature Does

Send SMS/Email/Push notifications:
- Provider-agnostic: MSG91 (SMS), Resend (Email), Firebase (Push)
- Dry-run mode: if no provider env var set, sends are logged but not delivered
- Two modes: Template mode (use saved template + userIds) or Direct mode (raw compose)
- Auto-substitutes `{{variables}}` from user data in template mode
- Max 1000 recipients per send (safety limit)
- Every send logged to NotificationLog + AdminAction audit trail

## Provider Configuration

| Channel | Provider | Env Var | Pricing |
|---------|----------|---------|---------|
| SMS | MSG91 | `MSG91_AUTH_KEY` | ₹0.20-0.30/SMS |
| Email | Resend | `RESEND_API_KEY` | 3K/month free |
| Push | Firebase Cloud Messaging | `FCM_SERVER_KEY` | Free |

**Without env vars:** sends run in dry-run mode (logged with status=skipped)

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Engagement** group in sidebar
- Click **Send Notifications** (send icon, 2nd item)

### 2. Overview tab (default)
- At top: **Provider Configuration banner** — 3 cards:
  - SMS — "Dry-run" badge (MSG91_AUTH_KEY not set yet)
  - Email — "Dry-run" badge (RESEND_API_KEY not set yet)
  - Push — "Dry-run" badge (FCM_SERVER_KEY not set yet)
- 4 KPI cards: Total Sent (0), Delivered (0), Failed (0), Skipped (0)
- **Notifications by Channel** card — 3 bars (SMS blue, Email violet, Push amber) all at 0
- **"How sending works"** transparency card

### 3. Click "Compose & Send" tab
- Mode toggle: **Use Template** | **Direct Compose** (default: Use Template)
- If no active templates: "No active templates found. Go to Notification Templates page to create one and set its status to 'active'."

### 4. Test Direct Compose mode (no template needed)
- Click **"Direct Compose"** button
- Fill in:
  - **Channel**: `sms`
  - **Body**: `Hi Rahul, this is a test notification from BahiKhata Pro admin.`
  - **Recipients** (one per line): `9876543210`
- Click **"Show Preview"** — shows the body text
- Click **"Send Notification"**
- Green toast: "Notifications processed — Sent: 0 · Failed: 0 · Skipped: 1"
- Send is logged with status=skipped (dry-run — no SMS provider configured)

### 5. Test email direct send
- Channel: `email`
- Subject: `Test Email from BahiKhata Pro`
- Body: `Hello, this is a test email.`
- Recipients: your-email@example.com
- Send → "Sent: 0 · Failed: 0 · Skipped: 1"

### 6. Click "Send History" tab
- See your recent sends (1 row per recipient)
- Each row: Recipient, Channel badge, Template name (or "Direct send"), Status badge (skipped=amber), Provider (dry-run), Sent At
- Test search: type "9876543210" → filters to that recipient
- Test filters: click "sms" channel pill → only SMS sends; "skipped" status pill → only skipped

### 7. Use Template mode (requires active template)
- First, go to **Notification Templates** page → create a template → set status to "active"
- Come back to Send Notifications → Compose tab
- Select the template from dropdown → preview shows template body
- Enter user IDs (one per line) — get these from the Users page (`/users`)
- Send → variables like `{{userName}}` and `{{plan}}` auto-substituted from each user's data

### 8. Enable real sending (optional)
- To actually deliver SMS: get MSG91 API key → add `MSG91_AUTH_KEY` to Vercel env vars
- To actually deliver Email: get Resend API key → add `RESEND_API_KEY` to Vercel env vars
- To actually deliver Push: get FCM server key → add `FCM_SERVER_KEY` to Vercel env vars
- After adding, refresh page — Provider Configuration banner shows "✓ MSG91" / "✓ Resend" / "✓ Firebase"
- Future sends will actually deliver (not dry-run)

### 9. Verify audit trail
- Go to **Audit Log** page (`/audit-log`)
- See `notification_send` action with description showing counts

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (6 parallel count/groupBy queries) |
| History tab | ~100ms (findMany with take=20 + count) |
| Max recipients per send | 1000 (safety limit) |
| Sending strategy | Sequential (avoids provider rate-limit bans) |
| Cache | 60s staleTime (30s for history) |

## Safety Features

- **Max 1000 recipients per send** — prevents accidental mass send
- **Sequential sending** — avoids MSG91/Resend/FCM rate-limit bans
- **Every send logged** — to NotificationLog (success/failure/skip) + AdminAction
- **Dry-run fallback** — test entire flow without spending money on providers
- **Variable auto-substitution** — `{{userName}}`, `{{plan}}`, etc. from user data
