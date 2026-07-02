# Phase 1.6 (2/5) — Risk & Compliance

**Page URL:** `/risk`
**Sidebar location:** System group → Risk & Compliance (alert triangle icon)
**Commit:** `a9916e3`

## What This Feature Does

Risk & compliance analytics:
- Fraud detection: duplicate phones, inactive new users, high-value transactions
- DPDP Act compliance: users with data, export/delete requests, compliance score
- Security overview: failed/successful logins, brute force IPs, admin actions
- Data breach readiness checklist (8 items)
- Breach response playbook (DPDP 72-hour rule)
- Uses `groupBy(phone)` and `groupBy(ip)` (was findMany+JS group — OOM risk at 1M users)

## How to Test

### 1. Open the page
- Login to admin panel
- Click **Risk & Compliance** in the sidebar (System group, alert triangle icon)

### 2. Overview tab (default)
- At top: **Overall Risk Level banner** — colored card (green=low, amber=medium, orange=high, red=critical) with score /100
- 4 KPI cards:
  - Duplicate Phones (count + "same phone, multiple accounts")
  - Inactive New Users (count + "no activity after 7 days")
  - Failed Logins 24h (count + success rate %)
  - Brute Force IPs (count + "5+ failed attempts")
- Two side-by-side cards:
  - **DPDP Act Compliance** — users with data, export/delete requests, compliance score /100
  - **Data Breach Readiness** — 8-item checklist with green ✓ Ready / red ✗ Missing
- **Amber Breach Response Playbook** card with 8-step process
- **"How data is computed"** transparency card at bottom

### 3. Click "Fraud Detection" tab
- Two cards:
  - **Duplicate Phone Numbers** — list of phones used by multiple accounts (paginated if >20)
  - **High-Value Transactions (₹1L+)** — table with user, type, amount, date (paginated if >20)
- If empty: green checkmark "No duplicate phones detected"
- Click any user name → navigates to `/users/[id]`
- If >20 results, pagination controls appear

### 4. Click "Security" tab
- Two cards:
  - **Brute Force IPs (5+ fails in 24h)** — list of IPs with failed login count (red highlight, paginated)
  - **Admin Actions by Type (Last 30 Days)** — top 10 admin actions with counts
- If no brute force: green checkmark "No brute force attempts detected"

### 5. Verify no 30s polling
- Open DevTools → Network tab → filter by "risk"
- Should see ONE request per tab switch, then NO auto-refresh

### 6. Verify resilience
- If any KPI shows 0 unexpectedly, check console — query likely failed silently and returned safe default (no crash)

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (10 parallel count queries) |
| Fraud tab | ~100ms (groupBy + paginated findMany) |
| Security tab | ~100ms (groupBy + paginated) |
| Polling | None (was 30s before — removed) |
| OOM risk | Eliminated (was findMany(ALL users) — now groupBy) |
