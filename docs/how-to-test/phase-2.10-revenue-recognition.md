# Phase 2 (10/22) — Revenue Recognition

**Page URL:** `/revenue-recognition`
**Sidebar location:** Revenue group → Revenue Recognition (file bar chart icon)
**Commit:** `pending`

## What This Feature Does

Accrual-based revenue tracking (GAAP / Ind AS 115 compliant):
- Splits each subscription payment into monthly recognition entries
- Tracks **deferred revenue** (unearned — liability on balance sheet)
- Tracks **recognized revenue** (earned — appears on income statement)
- 3 tabs: Overview (KPIs + month-over-month), Schedule Entries (paginated list), Monthly Breakdown (bar charts)
- "Recompute Schedules" button to regenerate from subscriptions (10-min cooldown)

## Why This Matters

**Cash accounting** (wrong for SaaS):
- User pays ₹2,988 for yearly Pro on Jan 1
- Recognize ₹2,988 revenue on Jan 1
- Feb-Dec: ₹0 revenue
- → Revenue looks spiky and misleading

**Accrual accounting** (correct for SaaS):
- User pays ₹2,988 for yearly Pro on Jan 1
- Recognize ₹249/month for 12 months
- → Revenue is smooth and predictable (matches service delivery)
- → Required by GAAP (US) and Ind AS 115 (India)

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Revenue** group in sidebar (emerald trending up icon)
- Click **Revenue Recognition** (file bar chart icon, 3rd item)

### 2. Overview tab (default)
- If no schedules computed yet: all KPIs show ₹0
- 4 KPI cards:
  - **Recognized Revenue** (₹X — earned, past periods)
  - **Deferred Revenue** (₹X — unearned, future periods, liability)
  - **Current Month Revenue** (₹X — being earned this month)
  - **Total Scheduled** (₹X — across all subscriptions)
- **Month-over-Month Comparison** card (if data exists):
  - Last month vs this month
  - Delta percentage badge (green ↑ / red ↓)
- **"How revenue recognition works"** transparency card

### 3. Recompute schedules (FIRST STEP — required to generate data)
- Click **"Recompute Schedules"** button (top-right)
- Button shows spinner: "Recomputing..."
- After 2-30 seconds (depending on subscription count), green toast:
  > "Recomputed — X subscriptions, Y entries in Z.Zs"
- 10-minute cooldown starts (button shows countdown)

### 4. After recompute — verify Overview tab
- KPI cards should now show actual values:
  - **Recognized Revenue**: sum of all past-month entries
  - **Deferred Revenue**: sum of all future-month entries
  - **Current Month Revenue**: sum of current-month entries
  - **Total Scheduled**: sum of all entries
- Month-over-Month card should show last month vs this month comparison

### 5. Click "Schedule Entries" tab
- Status filter pills: All / Pending / Current / Recognized
- Paginated table (20 per page):
  - **Period**: Month + date range (e.g. "Jan 2026" + "Jan 1 – Jan 31")
  - **Plan**: Pro / Elite badge
  - **Status**: Pending (amber clock) / Current (blue calendar) / Recognized (green check)
  - **Amount**: ₹X (monthly recognition amount)
  - **Recognized At**: When the period was recognized (or "—" for pending/current)

### 6. Test status filters
- Click "pending" → shows only future-month entries
- Click "current" → shows only this month's entries
- Click "recognized" → shows only past-month entries
- Click "all" → shows everything

### 7. Click "Monthly Breakdown" tab
- **Recognized Revenue per Month** — horizontal bar chart (green bars)
  - Each bar shows ₹ amount at the end
  - Bars proportional to the month with highest revenue
- **Deferred Revenue per Month** — horizontal bar chart (amber bars)
  - Shows how much revenue is still deferred at each month end
- **Summary table** at bottom:
  - Month | Recognized | Deferred | Entries (count)

### 8. Verify the math
- Pick a subscription from the Subscriptions page
- Note: amount, startDate, endDate
- Calculate: monthlyAmount = amount / numberOfMonths
- Go to Schedule Entries tab → find entries for that subscription
- Each entry should have the calculated monthlyAmount
- Example: ₹2,988 yearly Pro → 12 entries × ₹249/month = ₹2,988 total

### 9. Test pagination
- If >20 schedule entries, pagination controls appear
- Click page 2, 3 → next 20 entries load

## Schedule Entry Lifecycle

```
pending (future month) → current (this month) → recognized (past month)
```

| Status | Color | Meaning |
|--------|-------|---------|
| `pending` | Amber (warning) | Future month — revenue not yet earned |
| `current` | Blue (info) | This month — revenue being earned |
| `recognized` | Green (success) | Past month — revenue fully earned |

## Example Calculation

**User pays ₹2,988 for yearly Pro on Jan 1, 2026:**

| Month | Status | Amount | Cumulative Recognized | Deferred |
|-------|--------|--------|----------------------|----------|
| Jan 2026 | recognized | ₹249 | ₹249 | ₹2,739 |
| Feb 2026 | recognized | ₹249 | ₹498 | ₹2,490 |
| Mar 2026 | recognized | ₹249 | ₹747 | ₹2,241 |
| ... | ... | ... | ... | ... |
| Dec 2026 | recognized | ₹249 | ₹2,988 | ₹0 |

**Total: 12 entries × ₹249 = ₹2,988**

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (6 parallel aggregate queries) |
| Schedule Entries tab | ~100ms (findMany with take=20 + count) |
| Monthly Breakdown tab | ~200ms (12 months × 2 aggregate queries each) |
| Recompute (1000 subscriptions) | ~30-60s (batched in chunks of 100) |
| Cooldown | 10 minutes between recomputes |

## GAAP / Ind AS Compliance

This implementation follows:
- **ASC 606** (US GAAP): Revenue from Contracts with Customers
- **Ind AS 115** (Indian Accounting Standards): Revenue from Contracts with Customers

Key principles:
1. Revenue is recognized **over time** as the service is delivered
2. The **recognition pattern** matches the period of benefit to the customer
3. **Deferred revenue** is reported as a **liability** on the balance sheet
4. **Recognized revenue** appears on the **income statement**

## Integration Points

This feature connects to:
- **Subscriptions** (`/subscriptions`): Source of subscription data (amount, dates, plan)
- **MRR & Forecast** (`/revenue`): Uses recognized revenue for accurate MRR
- **Partner Management** (`/partners`): Revenue share calculations use recognized amounts
- **Financial Reporting** (Phase 2.11 — future): P&L statements, balance sheet
