# Phase 3 (3/5) — Lending Pipeline

**Page URL:** `/lending-pipeline`
**Sidebar location:** Intelligence group → Lending Pipeline (banknote icon)
**Commit:** `pending`

## What This Feature Does

Delivers credit-scored leads to NBFC partners via webhooks:
- Fetches eligible leads from `CreditScoreCache` (score ≥ 550, i.e. fair+)
- Dispatches `lead.created` webhook event to all NBFC partners subscribed
- Revenue per lead: ₹200 (excellent), ₹150 (good), ₹100 (fair)
- Poor band (<550) not delivered (not eligible for lending)
- Recommended loan amounts calculated per lead
- 5-minute cooldown between deliveries
- Max 100 leads per synchronous delivery

## Revenue Model

| Band | Score Range | Revenue/Lead | Recommended Loan |
|------|------------|-------------|-----------------|
| Excellent | 750+ | ₹200 | 5× monthly sales |
| Good | 650-749 | ₹150 | 3× monthly sales |
| Fair | 550-649 | ₹100 | 1.5× monthly sales |
| Poor | <550 | ₹0 (not delivered) | — |

## How to Test

### 1. Open the page
- Login → Intelligence group → **Lending Pipeline** (banknote icon, 4th item)

### 2. Overview tab (default)
- 4 KPI cards: Eligible Leads, Potential Revenue, Delivered (all time), Active NBFC Partners
- **Lead Distribution by Credit Band** card — 4 colored cards with count + revenue per band
- **Recent Lead Deliveries** card — last 10 webhook deliveries with partner + status + HTTP code
- "How the lending pipeline works" transparency card

### 3. Prerequisites
- Credit scores must be computed first (go to Data Monetization → Recompute Scores)
- At least 1 NBFC partner must exist (Partners page → create partner with type=nbfc)
- At least 1 webhook endpoint must exist (Webhooks page → create endpoint subscribed to `lead.created`)

### 4. Deliver leads
- Click **"Deliver Leads Now"** (green, top-right)
- Spinner: delivering...
- Green toast: "Delivered X leads to Y endpoints — Revenue: ₹Z"
- 5-minute cooldown starts

### 5. Click "Top Leads" tab
- Table of top 50 eligible candidates (score ≥ 550)
- Columns: rank, user (links to /users/[id]), score/900, band badge, monthly sales, recommended loan, revenue/lead
- Footer: total potential revenue (sum of all leads' revenue)
- Sorted by score descending

### 6. Verify deliveries
- Go to Webhooks page → Delivery Logs tab
- Filter by status or look for `lead.created` event type
- Each delivery shows: partner name, endpoint URL, HTTP status, error (if any)

### 7. Verify audit trail
- Audit Log → `lending_pipeline_deliver` action with candidate/deliver/revenue counts

## Integration Points

This feature connects:
- **Data Monetization** (`/data`): Source of credit scores (CreditScoreCache)
- **Partners** (`/partners`): NBFC partners receive leads
- **Webhooks** (`/webhooks`): Lead delivery mechanism (dispatchEvent + HMAC + retry)
- **Revenue Recognition** (`/revenue-recognition`): Lead revenue tracked as subscription revenue
- **Financial Reports** (`/financial-reports`): Lending revenue appears in P&L

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (7 parallel count + aggregate + findMany) |
| Leads tab | ~100ms (findMany with take=50) |
| Delivery | ~500ms (dispatchEvent + 100 leads) |
| Cooldown | 5 minutes between deliveries |
| Max leads per delivery | 100 (synchronous — production: background job) |
