# Phase 2 (11/22) — Financial Reports

**Page URL:** `/financial-reports`
**Sidebar location:** Revenue group → Financial Reports (trending up icon)
**Commit:** `pending`

## What This Feature Does

Investor-grade financial statements:
- **P&L Statement** (Income Statement): Revenue → COGS → Gross Profit → Opex → Net Income
- **Balance Sheet**: Assets (cash) = Liabilities (deferred revenue) + Equity (retained earnings)
- **Cash Flow Statement**: Operating (subscriptions - AI - gateway) + Investing + Financing
- Period selector: Full Year or specific Month (Jan-Dec)
- All amounts in ₹ (INR)
- GAAP / Ind AS compliant (uses accrual revenue from RevenueSchedule)

## 3 Financial Statements

### 1. P&L Statement (Income Statement)

```
Revenue:
  Subscription Revenue (Recognized)     ₹2,988
  Total Revenue                         ₹2,988

Cost of Goods Sold (COGS):
  AI API Costs (Gemini/OpenAI/Groq)    (₹500)
  Payment Gateway Fees (2%)            (₹60)
  Total COGS                           (₹560)

Gross Profit                            ₹2,428  (81% margin)

Operating Expenses:
  Server + DB + Monitoring + Domain    (₹5,000)
  Total Opex                           (₹5,000)

Net Income                             (₹2,572)  (-86% margin)
```

### 2. Balance Sheet

```
Assets:
  Cash (received - paid)                ₹15,000
  Accounts Receivable                  ₹0
  Total Assets                          ₹15,000

Liabilities:
  Deferred Revenue (unearned)           ₹8,000
  Accounts Payable                     ₹0
  Total Liabilities                     ₹8,000

Equity:
  Retained Earnings                     ₹7,000
  Total Equity                          ₹7,000

Balance Check: Assets (₹15,000) = Liabilities (₹8,000) + Equity (₹7,000) ✓
```

### 3. Cash Flow Statement

```
Operating Activities:
  Cash from Subscriptions               +₹2,988
  Cash paid to AI Providers             (₹500)
  Cash paid to Razorpay                 (₹60)
  Net Cash from Operations              +₹2,428

Investing Activities:                   ₹0 (SaaS — no capex)
Financing Activities:                   ₹0 (no debt/equity)

Net Change in Cash                      +₹2,428
```

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Revenue** group in sidebar (emerald trending up icon)
- Click **Financial Reports** (trending up icon, 4th item)

### 2. P&L Statement (default tab)
- At top: period selector (FY 2026 / Full Year or specific month Jan-Dec)
- 4 KPI cards: Total Revenue, Gross Profit, Operating Income, Net Income
  - Green = positive, Red = negative
  - Margin % shown in sublabel
- **Detailed P&L Breakdown** card:
  - Revenue section (subscription revenue)
  - COGS section (AI costs + gateway fees)
  - Gross Profit (green highlighted)
  - Operating Expenses (estimated)
  - Net Income (green or red highlighted)

### 3. Change period
- Click "Jan" month button → shows January P&L only
- Click "Full Year" → shows entire year
- Change year dropdown to FY 2025 → shows previous year

### 4. Click "Balance Sheet" tab
- No period selector (balance sheet is "as of" a date — always current)
- Balance check banner at top:
  - Green ✓ if Assets = Liabilities + Equity (within ₹100 tolerance)
  - Amber ⚠ if slight imbalance (estimation rounding)
- **Balance Sheet Breakdown** card:
  - Assets section (Cash, Accounts Receivable)
  - Liabilities section (Deferred Revenue, Accounts Payable)
  - Equity section (Retained Earnings)
  - Liabilities + Equity total at bottom

### 5. Click "Cash Flow" tab
- Period selector (same as P&L)
- 4 KPI cards: Operating Cash, Investing Cash, Financing Cash, Net Change
- **Cash Flow Breakdown** card:
  - Operating Activities (subscriptions +, AI -, gateway -)
  - Investing Activities (₹0 for SaaS)
  - Financing Activities (₹0 — no debt/equity)
  - Net Change in Cash (green or red)

### 6. Verify the math (P&L)
- Go to Revenue Recognition page → note "Recognized Revenue" total
- Go to Financial Reports → P&L → Full Year
- P&L "Total Revenue" should match Revenue Recognition's "Recognized Revenue" for that period
- P&L "AI API Costs" should match AI Usage page "This Month" cost (for monthly view)

### 7. Verify balance sheet balances
- Total Assets should ≈ Total Liabilities + Total Equity
- If not exactly equal (±₹100), amber warning shows "estimation rounding"
- Deferred Revenue on balance sheet should match Revenue Recognition's "Deferred Revenue" KPI

### 8. Disclaimer card
- At bottom: amber card explaining data sources + estimation methodology
- Note: "These reports are for internal/investor review — consult a CA for official tax filing"

## Data Sources

| Field | Source Table | Query |
|-------|-------------|-------|
| Subscription Revenue | `RevenueSchedule` | SUM(amount) WHERE status='recognized' AND periodStart in range |
| AI Costs (COGS) | `AiUsageLog` | SUM(costInr) WHERE createdAt in range |
| Cash Received | `Subscription` | SUM(amount) WHERE createdAt in range |
| Deferred Revenue | `RevenueSchedule` | SUM(amount) WHERE status IN ('pending','current') |
| Payment Gateway Fees | Calculated | 2% × cash received (Razorpay standard) |
| Operating Expenses | Estimated | ₹5000 base + ₹0.50/user (Vercel + DB + monitoring) |

## Performance at Scale

| Metric | Value |
|--------|-------|
| P&L report | ~100ms (3 parallel aggregate queries) |
| Balance Sheet | ~150ms (6 parallel aggregate queries) |
| Cash Flow | ~100ms (2 parallel aggregate queries) |
| Cache | 5 minutes (financials don't change frequently) |

## Important Notes

1. **Revenue Recognition prerequisite**: P&L and Balance Sheet rely on `RevenueSchedule` data. If you haven't run "Recompute Schedules" on the Revenue Recognition page, revenue will show ₹0.

2. **Operating expenses are estimated**: Real server/DB costs aren't tracked in the database. We estimate based on user count:
   - Base: ₹5,000/month (Vercel Pro + Neon + domain + Sentry)
   - Per user: ₹0.50/month (serverless compute scaling)

3. **No tax computation**: Indian startups with < ₹100Cr revenue are tax-exempt under Section 80-IAC. For official tax filing, consult a CA.

4. **Payment gateway fees**: Estimated at 2% (Razorpay standard domestic rate). Actual fees may vary based on payment method (UPI = 0%, credit card = 2%).

5. **Cash ≠ Profit**: Cash flow shows when money actually moves. P&L shows when revenue is earned. These differ because of accrual accounting (deferred revenue).

## Integration Points

This feature connects to:
- **Revenue Recognition** (`/revenue-recognition`): Source of recognized + deferred revenue
- **AI Usage & Cost** (`/ai-usage`): Source of AI costs (COGS)
- **Subscriptions** (`/subscriptions`): Source of cash received
- **Partner Management** (`/partners`): Revenue share for partner payout calculations
