# Phase 3 (2/5) — Supplier Intelligence

**Page URL:** `/supplier-intelligence`
**Sidebar location:** Intelligence group → Supplier Intelligence (package icon)
**Commit:** `pending`

## What This Feature Does

Anonymized market data reports for FMCG partners:
- 4 report types: product trends, transaction volume, payment patterns, category analysis
- All data AGGREGATED across all users (no individual user data exposed)
- DPDP compliant: fully anonymized, no PII
- Reports sold to FMCG partners (₹30K-₹1L per report)
- Expandable report details with full JSON data
- Suggested pricing per report type
- Uses bulk groupBy + raw SQL (not per-user queries)

## 4 Report Types

| Type | Description | Suggested Price |
|------|-------------|-----------------|
| `product_trends` | Top 50 products by store count + avg sale price | ₹50,000 |
| `transaction_volume` | Monthly transaction counts + amounts (last 6 months) | ₹75,000 |
| `payment_patterns` | Payment method distribution (UPI/cash/card) | ₹30,000 |
| `category_analysis` | Sales by product category with margin estimates | ₹100,000 |

## How to Test

### 1. Open the page
- Login → Intelligence group → **Supplier Intelligence** (package icon, 3rd item)

### 2. Overview tab (default)
- 4 KPI cards: Total Reports, Revenue Potential, Report Types (4), Delivered
- **Available Report Types** card — 4 report types with descriptions + suggested prices
- "How supplier intelligence works" transparency card with privacy/compliance info

### 3. Generate a report
- Click **"Generate Report"** (top-right)
- Modal opens (white background)
- Select: Type (`Product Trends`), Name (`Q2 2026 Product Trends`), Price (auto-filled suggested ₹50,000)
- Click "Generate"
- Green toast with summary: "Top X products across Y stores..."
- Report appears in list

### 4. Generate another report
- Type: `Transaction Volume`, Name: `H1 2026 Transaction Analysis`
- Green toast with monthly summary

### 5. Click "All Reports" tab
- See generated reports with: name, status badge, type badge, summary, data points, user count, price, time
- Click any report → expands to show full JSON data

### 6. Verify data is anonymized
- Expanded report data should contain ONLY:
  - Product names (not user IDs)
  - Counts and sums (not individual transactions)
  - Aggregated statistics (not raw data)
- No user emails, IDs, or PII anywhere in the data

### 7. Verify audit trail
- Audit Log → `supplier_report_generate` action

## Privacy Guarantees

| Rule | Enforcement |
|------|------------|
| No individual user data | Only groupBy/aggregate queries used |
| No PII | No user IDs, emails, names in report data |
| Aggregated only | Counts, sums, averages |
| DPDP compliant | Anonymized data is not "personal data" under DPDP |

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (4 parallel count + aggregate + groupBy) |
| List tab | ~100ms (findMany) |
| Report generation | ~200-500ms (1-3 aggregate/groupBy queries per type) |
| Cache | 60s (overview), 30s (list) |
