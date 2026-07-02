# Phase 1.6 (3/5) — Subscriptions

**Page URL:** `/subscriptions`
**Sidebar location:** Revenue group → Subscriptions (credit card icon)
**Commit:** `141ff10`

## What This Feature Does

Subscription analytics:
- 4 KPI cards: Active count, MRR, ARPU, Cancelled+Expired
- Plan distribution: Pro (amber) vs Elite (violet) with progress bars
- Active tab: paginated list of active subscribers (search + plan filter)
- Payment History tab: paginated list of all payments (search + status filter)
- MRR computed DB-side via `aggregate({_sum: amount})` (was JS reduce before)
- Converted from server component to client (no more 500 on DB sleep)

## How to Test

### 1. Open the page
- Login to admin panel
- Click **Subscriptions** in the sidebar (Revenue group, credit card icon)

### 2. Overview tab (default)
- 4 KPI cards:
  - **Active Subscriptions** (count + "X new in last 30 days")
  - **Monthly Recurring Revenue** (₹X — sum of all active amounts)
  - **Avg Revenue / User (ARPU)** (₹X — MRR ÷ active count)
  - **Cancelled + Expired** (count + breakdown)
- **Plan Distribution** card with 2 progress bars:
  - Pro (amber bar) — count + revenue + % share
  - Elite (violet bar) — count + revenue + % share
- **"How data is computed"** transparency card at bottom

### 3. Click "Active Subscriptions" tab
- Search bar + 3 plan filter pills (All Plans / pro / elite)
- Paginated table (20 per page): User (name+email+avatar), Plan badge, Amount, Payment Mode, Renews date
- Click any user → navigates to `/users/[id]`
- Search by user email → filters server-side
- Click "elite" filter → only elite subscribers

### 4. Click "Payment History" tab
- Search bar + 4 status filter pills (All / active / cancelled / expired)
- Paginated table: User, Plan, Amount, Status badge, Payment ID (truncated), Date (relative)
- Filter by "cancelled" → only cancelled payments show

### 5. Verify no server crash on DB sleep
- Old page was server component — if Neon DB was asleep, page returned 500
- New page is client component — shows loading skeleton, then data (or empty state)

### 6. Verify no polling
- DevTools → Network → filter by "subscriptions"
- Should see ONE request per tab switch, then NO auto-refresh

### 7. If no subscriptions exist yet
- Overview: all KPIs show 0 / ₹0
- Plan distribution: "No active subscriptions yet"
- Active tab: "No active subscriptions found"
- Recent tab: "No payments have been made yet"
- No crashes, no white screen

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (6 parallel aggregate queries) |
| Active tab | ~100ms (findMany with take=20 + count) |
| Recent tab | ~100ms (findMany with take=20 + count) |
| Polling | None |
| Cache | 60s staleTime |
| DB sleep crash | Fixed (was server component, now client + API) |
