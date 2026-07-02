# Phase 2 (8/22) — API Key Management

**Page URL:** `/api-keys`
**Sidebar location:** Intelligence group → API Keys (key icon)
**Commit:** `pending`

## What This Feature Does

Partner API keys with scoped permissions:
- Generate cryptographically secure API keys (`bkh_live_<48 chars>`)
- Store only SHA-256 hashes (never raw keys — even DB breach can't reveal them)
- 6 scopes: read_leads, write_leads, read_analytics, read_users, read_revenue, admin
- Show full key ONCE on creation (admin must save it)
- Track usage: lastUsedAt, usageCount per key
- Lifecycle: active → revoked (soft delete) | expired (auto)
- All actions logged to AdminAction audit trail

## Security Model

```
┌─────────────────────────────────────────────────────────────┐
│                    API Key Security Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Admin clicks "New API Key"                              │
│     ↓                                                        │
│  2. Backend generates:                                      │
│     - rawKey = "bkh_live_" + base64url(32 random bytes)     │
│     - keyHash = SHA-256(rawKey)                             │
│     - keyPrefix = rawKey.slice(0, 12)  // for display       │
│     ↓                                                        │
│  3. DB stores: keyHash + keyPrefix (NEVER rawKey)           │
│     ↓                                                        │
│  4. Frontend shows rawKey ONCE in modal                     │
│     - Admin must copy + save it                             │
│     - Modal won't close until "I've Saved the Key" clicked  │
│     ↓                                                        │
│  5. Partner uses rawKey in API requests:                    │
│     Authorization: Bearer bkh_live_AbCdEf123...             │
│     ↓                                                        │
│  6. Backend verifies:                                       │
│     - Hash provided key with SHA-256                        │
│     - Compare with stored hash using timingSafeEqual        │
│     - Check scopes + status + expiration                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 6 Available Scopes

| Scope | Description | Use Case |
|-------|-------------|----------|
| `read_leads` | GET credit-scored leads | NBFC lending partners |
| `write_leads` | POST lead status updates | NBFC updates (approved/rejected) |
| `read_analytics` | GET aggregate analytics | FMCG supplier intelligence |
| `read_users` | GET anonymized user data | Market research (no PII) |
| `read_revenue` | GET revenue/payout data | Partner reconciliation |
| `admin` | Full access to all endpoints | ⚠️ DANGEROUS — internal only |

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Intelligence** group in sidebar (orange brain icon)
- Click **API Keys** (key icon, 5th item)

### 2. Overview tab (default)
- 4 KPI cards: Active Keys (0), Total API Calls (0), Revoked (0), Expired (0)
- **Available Scopes (6 permissions)** card — shows all 6 scopes with descriptions
  - `admin` scope shows red "DANGEROUS" badge
- **Security Best Practices** amber card with 6 tips
- **"How API key security works"** transparency card explaining key generation + storage

### 3. Create your first API key
- Click **"+ New API Key"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Name**: `Bajaj Production Key`
  - **Partner**: (paste a partner ID from the Partners page, or leave empty for internal)
  - **Scopes**: Check `read_leads` + `write_leads`
  - **Expires At**: 1 year from now (or leave empty for never)
- Note the amber warning: "The full API key will be shown ONCE after creation"
- Click **"Create Key"**

### 4. ⚠️ Save the raw key (CRITICAL)
- After creation, a **modal with amber header** appears: "Save Your API Key Now"
- The full key is shown: `bkh_live_AbCdEf1234567890...` (~52 chars)
- Click **"Copy"** button → key copied to clipboard
- **Save it NOW** in a password manager or secure location
- The warning says: "This is the ONLY time you'll see this key"
- Click **"I've Saved the Key"** to close

### 5. View in List tab
- Switch to "All Keys" tab
- See your key with:
  - Name
  - Key Prefix: `bkh_live_AbC…` (only first 12 chars shown — rest is hashed)
  - Partner (or "Internal")
  - Scopes badges: `read leads`, `write leads`
  - Status: `active` (green)
  - Usage: 0
  - Last Used: Never
  - Actions: Revoke (shield icon), Edit, Delete

### 6. Test the "admin" scope warning
- Click "+ New API Key"
- Check the `admin` scope checkbox
- Confirmation dialog: "The 'admin' scope grants FULL access... Continue?"
- Click Cancel → admin scope not added
- Click OK → admin scope added (all other scopes auto-removed since admin implies all)

### 7. Test revoke (soft delete)
- On any active key, click the **shield icon** (Revoke)
- Confirmation: "Revoke API key X? The key will immediately stop working but remain in the list for audit."
- Click OK → status changes to `revoked` (red badge)
- The key is now disabled but still visible in the list (for audit trail)

### 8. Test delete (hard delete)
- Click the **trash icon** on any key
- Confirmation: "Delete API key X? This cannot be undone. The key will immediately stop working."
- Click OK → key permanently removed from list

### 9. Test edit
- Click the **pencil icon** on any key
- Editor opens — you can change name, scopes, status, expiration
- Note: You CANNOT see or change the raw key (only hash is stored)
- To rotate a key: revoke old → create new

### 10. Test search
- Type "bajaj" in search bar → only Bajaj keys show
- Type "bkh_live" → matches key prefixes

### 11. Test filters
- Click "active" status pill → only active keys show
- Click "revoked" → only revoked keys show

### 12. Verify audit trail
- Go to **Audit Log** page (`/audit-log`)
- See `api_key_create`, `api_key_update` (revoke), `api_key_delete` actions
- Descriptions include key prefix (for identification without revealing the key)

## Security Best Practices

1. **Use scoped keys** — never use `admin` scope when a narrower scope works
2. **Set expiration dates** on partner keys (renew contractually)
3. **Revoke immediately** if a key is compromised (don't delete — keep for audit)
4. **Rotate annually** — revoke old keys, create new ones
5. **One key per partner per environment** — don't reuse keys across partners or prod/staging
6. **Never commit keys to git** — use environment variables
7. **Use password managers** — don't store keys in plain text files

## Key Format

```
bkh_live_<43 chars of base64url>

Example: bkh_live_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abc
                                          ^^^^^^^^^^^^^^^^^^^
                                          URL-safe base64 (no +, /, =)

Total length: ~52 characters
Entropy: 256 bits (infeasible to brute-force)
```

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (6 parallel count + aggregate queries) |
| List tab | ~100ms (findMany with take=20 + count + partner join) |
| Key generation | < 1ms (crypto.randomBytes is fast) |
| Key verification | < 1ms (SHA-256 hash + timingSafeEqual) |
| Polling | None (60s staleTime) |

## Integration Points

This feature connects to:
- **Partner Management** (`/partners`): Keys are linked to partners via `partnerId`
- **Webhook Management** (Phase 2.9 — future): Partner webhooks authenticated via API keys
- **Lead Delivery** (Phase 3 — future): NBFC partners fetch leads using `read_leads` scope
- **Analytics API** (Phase 3 — future): FMCG partners fetch analytics using `read_analytics` scope

## API Usage Example (for partners)

```bash
# Partner fetches leads using their API key
curl https://api.bahikhata.pro/v1/leads \
  -H "Authorization: Bearer bkh_live_AbCdEf1234567890..." \
  -H "Content-Type: application/json"

# Response:
{
  "leads": [
    {
      "userId": "cmd123...",
      "creditScore": 780,
      "band": "excellent",
      "monthlySales": 250000,
      "collectionRate": 0.95
    }
  ]
}
```
