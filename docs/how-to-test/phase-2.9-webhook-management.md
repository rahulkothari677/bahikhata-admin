# Phase 2 (9/22) — Webhook Management

**Page URL:** `/webhooks`
**Sidebar location:** Intelligence group → Webhooks (webhook icon)
**Commit:** `pending`

## What This Feature Does

Partner webhook endpoints + delivery logs with retry:
- Create webhook endpoints tied to partners
- Subscribe endpoints to 6 event types (lead.created, payment.received, etc.)
- HMAC-SHA256 signature for request verification
- Delivery logs with full audit trail (payload, response, errors)
- Exponential backoff retry: immediate → 1m → 5m → 25m (4 attempts max)
- "Deliver Now" button to manually trigger pending deliveries
- Production: cron job runs every 1 minute

## 6 Webhook Events

| Event | Description | Trigger |
|-------|-------------|---------|
| `lead.created` | New credit-scored lead available | Credit score computed for user |
| `lead.updated` | Lead status changed | User's credit score re-computed |
| `payment.received` | Subscription payment received | Razorpay payment verified |
| `user.churned` | User cancelled subscription | Subscription status → cancelled |
| `campaign.completed` | Campaign finished all steps | Last campaign step sent |
| `anomaly.detected` | Anomaly detected | Z-score > 2.5 on any metric |

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Intelligence** group in sidebar (orange brain icon)
- Click **Webhooks** (webhook icon, 6th item)

### 2. Overview tab (default)
- 4 KPI cards: Active Endpoints (0), Total Delivered (0), Failed (0), Pending (0)
- **Available Webhook Events (6 types)** card — shows all events with descriptions
- **"How webhook delivery works"** transparency card

### 3. Create your first webhook endpoint
- First, make sure you have a partner created (from Partners page) — copy a Partner ID
- Click **"+ New Webhook"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Partner ID**: Paste partner ID from Partners page
  - **URL**: `https://httpbin.org/post` (free testing endpoint that echoes back)
  - **Events**: Check `lead.created` + `lead.updated`
  - **Description**: `Test webhook for Bajaj`
  - **Generate HMAC secret**: Checked (recommended)
- Click **"Create Webhook"**
- Green toast: "Webhook saved"
- If secret generated: blue toast "HMAC secret generated — check server logs"

### 4. View in Endpoints tab
- Switch to "Endpoints" tab
- See your endpoint with:
  - URL (truncated, monospace)
  - Partner name
  - Event badges: `lead.created`, `lead.updated`
  - Status: `active` (green)
  - Stats: ✓ 0 · ✗ 0
  - Last Sent: Never
  - Edit + Delete buttons

### 5. Test "Deliver Now"
- Click **"Deliver Now"** button (top-right, green)
- This processes any pending deliveries
- If no pending deliveries: toast "Processed 0 deliveries"
- If deliveries exist: toast "Processed X deliveries — Success: Y · Retrying: Z · Failed: W"

### 6. View Delivery Logs
- Switch to "Delivery Logs" tab
- If deliveries exist, each shows:
  - Status icon (spinner=retrying, check=success, X=failed, clock=pending)
  - Status badge
  - Event type badge (e.g. `lead.created`)
  - Attempt count (e.g. "Attempt 1/4")
  - HTTP status code (if sent)
  - Endpoint URL + partner name
  - Time ago
  - Error message (if failed)
  - Next retry time (if retrying)
  - Expandable payload (click "View payload")

### 7. Test filters
- On Endpoints tab: click "active" / "disabled" pills
- On Delivery Logs tab: click "pending" / "success" / "failed" / "retrying" pills

### 8. Edit endpoint
- Click pencil icon on any endpoint
- Change URL, events, or status
- Click "Update Webhook"

### 9. Delete endpoint
- Click trash icon
- Confirm: "Delete this webhook endpoint? All delivery logs will also be deleted."
- Endpoint + all delivery logs removed

### 10. Test retry logic (advanced)
- Create an endpoint with URL `https://httpbin.org/status/500` (always returns 500)
- Trigger an event → delivery created
- Click "Deliver Now" → delivery fails (HTTP 500)
- Delivery status = `retrying`, nextRetryAt = 1 minute from now
- Wait 1 minute → click "Deliver Now" again → attempt 2
- After 4 attempts → status = `failed`

## HMAC Signature Verification

When a webhook is sent, the request includes:

```
Headers:
  Content-Type: application/json
  X-Webhook-Event: lead.created
  X-Webhook-Delivery: cmd123...
  X-Webhook-Attempt: 1
  X-Webhook-Signature: <HMAC-SHA256 hex>

Body:
  { "event": "lead.created", "data": { ... } }
```

**Partner verifies signature:**
```python
import hmac, hashlib

received_sig = request.headers['X-Webhook-Signature']
expected_sig = hmac.new(
    secret.encode(),
    request.body,
    hashlib.sha256
).hexdigest()

if not hmac.compare_digest(received_sig, expected_sig):
    return 401  # Unauthorized
```

## Retry Schedule (Exponential Backoff)

| Attempt | When | Backoff |
|---------|------|---------|
| 1 | Immediate | — |
| 2 | 1 minute later | 1m |
| 3 | 5 minutes later | 5m |
| 4 | 25 minutes later | 25m |
| After 4 | Marked as `failed` | — |

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (6 parallel count + aggregate queries) |
| Endpoints tab | ~100ms (findMany with take=20 + count) |
| Delivery Logs tab | ~100ms (findMany with take=20 + count) |
| Delivery attempt | 10s timeout (via AbortController) |
| Batch processing | 50 deliveries per trigger |
| Production cron | Every 1 minute |

## Integration Points

This feature connects to:
- **Partner Management** (`/partners`): Endpoints linked to partners via `partnerId`
- **API Key Management** (`/api-keys`): Partners authenticate API calls, webhooks are outbound
- **Data Monetization** (`/data`): `lead.created` events when credit scores computed
- **Subscriptions** (`/subscriptions`): `payment.received` + `user.churned` events
- **Campaigns** (`/campaigns`): `campaign.completed` events
- **Anomaly Detection** (`/anomalies`): `anomaly.detected` events
