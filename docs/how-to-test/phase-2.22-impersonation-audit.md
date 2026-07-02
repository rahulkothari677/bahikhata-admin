# Phase 2 (22/22) — Impersonation Audit

**Page URL:** `/impersonation-log`
**Sidebar location:** System group → Impersonation Log (user check icon)
**Commit:** `pending`

## What This Feature Does

Audit trail of admin impersonation sessions:
- View all impersonation history (from AdminAction where action=`user_impersonate`)
- KPIs: total sessions, today, this week, unique admins, unique users impersonated
- Expandable rows with full details: admin, target user, reason, IP, user agent, token hash, expiry
- Founder-only access (non-founders see "Access Denied")
- DPDP compliant: all access to user data is tracked and auditable
- No new schema — reads from existing AdminAction table

## How to Test

### 1. Open the page
- Login → System group → **Impersonation Log** (user check icon, 8th item)
- ⚠️ Only founders can access — others see "Access Denied"

### 2. Overview tab (default)
- 4 KPI cards: Total Sessions, Today, This Week, Unique Admins (with unique users impersonated)
- **Security & Compliance** red card with 7 protections
- "How impersonation works" transparency card with process + use cases

### 3. Click "All Sessions" tab
- If no impersonation has happened yet: "No impersonation sessions"
- If sessions exist: expandable list with:
  - Admin name → target user email + plan badge
  - Reason for impersonation
  - Time ago + IP address
- Click row → expands to show full details: admin email, target user ID/email/name/plan, token expiry, IP, user agent, token hash (SHA-256), full description

### 4. Create an impersonation session (to generate test data)
- Go to **Users** page (`/users`)
- Click any user → user detail page
- Click "Impersonate" button
- Enter reason: "Testing impersonation audit log feature"
- You get a one-time link (expires in 5 minutes)
- Come back to Impersonation Log → your session appears at top

### 5. Verify expandable details
- Click any session row → expands
- See: admin email, target user ID/email/name/plan, token expiry, IP, user agent, token hash

### 6. Verify audit trail
- Go to Audit Log page → filter by action=`user_impersonate`
- Same data appears here too (Impersonation Log is a filtered view of Audit Log)

### 7. Test pagination
- If >20 sessions, pagination controls appear

## Security Features

| Protection | Description |
|-----------|-------------|
| Founder-only | Only founder role can impersonate + view logs |
| Reason required | Min 10 characters explaining why |
| 5-minute expiry | Token expires in 5 minutes |
| Single-use token | Token deleted after use |
| Full audit trail | Admin, target, reason, IP, user agent logged |
| DPDP compliant | All user data access tracked |
| Token hash only | SHA-256 hash stored, never the actual token |
