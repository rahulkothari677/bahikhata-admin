# Phase 3 (4/5) — GST Filing Service

**Page URL:** `/gst-filing`
**Sidebar location:** Revenue group → GST Filing (file text icon)
**Commit:** `pending`

## What This Feature Does

Prepare GST returns from transaction data:
- Aggregates all sale transactions with GST data (cgst, sgst, igst) for a given month
- Calculates total taxable value + total GST collected
- Splits into intra-state (CGST + SGST) and inter-state (IGST)
- Groups by tax slab (0%, 5%, 12%, 18%, 28%)
- Generates GSTR-1 (outward supplies) and GSTR-3B (monthly summary) formats
- CSV download for uploading to GST portal
- No new schema — reads existing Transaction data

## GST Slabs

| Slab | Rate | Common Items |
|------|------|-------------|
| 0% | Exempt | Essential goods, unbranded food |
| 5% | Low | Packaged food, textiles |
| 12% | Medium | Processed food, computers |
| 18% | Standard | Most goods & services |
| 28% | High | Luxury items, automobiles |

## How to Test

### 1. Open the page
- Login → Revenue group → **GST Filing** (file text icon, 5th item)

### 2. Overview (KPI cards at top)
- 4 KPI cards: GST This Month, GST Last Month, Total GST Collected, Users with GST Data

### 3. Select period
- Year dropdown (current year + 2 previous)
- Month buttons (Jan-Dec) — click to select month

### 4. View report
After selecting a period, the report shows:
- **Summary cards**: Taxable Value, CGST+SGST (Intra-state), IGST (Inter-state), Total GST
- **GST Breakdown by Tax Slab** table: slab badge, taxable value, CGST, SGST, IGST, count per slab
- **GSTR-3B Summary**: outward supplies, IGST, CGST, SGST, total tax liability + eligible users count
- "How GST filing works" transparency card with revenue opportunity calculation

### 5. Download CSV
- Click **"Download CSV"** button (top-right of report)
- File downloads: `gst_report_YYYY-MM.csv`
- CSV contains: summary, slab breakdown, GSTR-3B summary

### 6. Change period
- Click a different month → report regenerates automatically
- Change year dropdown → shows previous year's data

### 7. If no GST data for period
- Summary cards show ₹0
- Slab table is empty
- GSTR-3B shows 0 for all fields

## Revenue Opportunity

- Charge users ₹500-₹2,000 per GST filing
- Monthly filing for turnover > ₹1.5 crore
- Quarterly (QRMP) for turnover < ₹1.5 crore
- The "How it works" card shows: eligible users × ₹1,000/filing = potential monthly revenue

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview KPIs | ~100ms (4 parallel aggregate) |
| Report generation | ~200-500ms (findMany up to 50K transactions + JS aggregation) |
| Cache | 60s (overview), 5 min (report) |
