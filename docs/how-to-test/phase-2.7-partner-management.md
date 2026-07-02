# Phase 2 (7/22) — Partner Management

**Page URL:** `/partners`
**Sidebar location:** Intelligence group → Partners (handshake icon)
**Commit:** `pending`

## What This Feature Does

Directory of business partners for the lending + data-monetization pipeline:
- **4 partner types**: NBFC (lending), FMCG (supplier intelligence), Fintech, Other
- **4 statuses**: onboarding, active, inactive, terminated
- Track contact info, API base URL, webhook URL, revenue share %, contract dates
- Stats per partner: total leads sent, total revenue shared
- Overview tab: KPIs + partner type breakdown
- List tab: paginated, searchable, filterable by type + status
- All actions logged to AdminAction audit trail

## Partner Types & Revenue Models

| Type | Description | Revenue Model |
|------|-------------|---------------|
| NBFC | Non-Banking Financial Company (lending) | ₹200/₹150/₹100 per lead by credit band (excellent/good/fair) |
| FMCG | Fast-Moving Consumer Goods | ₹50K-₹5L per supplier intelligence report |
| Fintech | Other fintech integrations (payments, accounting) | Revenue share % (configurable per partner) |
| Other | Custom partnerships | Negotiated |

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Intelligence** group in sidebar (orange brain icon)
- Click **Partners** (handshake icon, 4th item)

### 2. Overview tab (default)
- 4 KPI cards: Active Partners (0), Total Leads Sent (0), Revenue Shared (₹0), Terminated (0)
- **Active Partners by Type** card — 4 type cards (NBFC, FMCG, Fintech, Other) each showing count + leads + revenue
- **"How partner management works"** transparency card

### 3. Create your first partner — NBFC
- Click **"+ New Partner"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Name**: `Bajaj Finance Ltd`
  - **Type**: `NBFC (Lending)`
  - **Status**: `onboarding`
  - **Contact Name**: `Rajesh Kumar`
  - **Contact Email**: `rajesh@bajajfinserv.in`
  - **Contact Phone**: `+91 98765 43210`
  - **Website**: `https://www.bajajfinserv.in`
  - **API Base URL**: `https://api.bajajfinserv.in/v1`
  - **Webhook URL**: `https://api.bajajfinserv.in/webhooks/leads`
  - **Revenue Share %**: `0` (NBFCs use per-lead pricing, not %)
  - **Contract Start**: today's date
  - **Contract End**: 1 year from now
  - **Notes**: `₹200/lead for excellent, ₹150/good, ₹100/fair credit band`
- Click **"Create Partner"**
- Green toast: "Partner saved"

### 4. Create a second partner — FMCG
- Click "+ New Partner" again
- Fill in:
  - **Name**: `Hindustan Unilever Ltd`
  - **Type**: `FMCG (Supplier Intel)`
  - **Status**: `onboarding`
  - **Contact Name**: `Priya Sharma`
  - **Contact Email**: `priya@unilever.com`
  - **Website**: `https://www.hindustanunilever.com`
  - **Notes**: `Quarterly supplier intelligence reports — ₹2L per report`
- Create

### 5. Create a third partner — Fintech
- **Name**: `Razorpay Software Pvt Ltd`
- **Type**: `Fintech`
- **Status**: `onboarding`
- **Revenue Share %**: `5` (5% revenue share)
- Create

### 6. View in List tab
- Switch to "All Partners" tab
- See 3 partners with:
  - Name + website link (clickable, opens new tab)
  - Type badge (NBFC/FMCG/Fintech with colored icon)
  - Status badge (onboarding = blue)
  - Contact name + email
  - Leads: 0, Revenue: ₹0
  - Edit + Delete buttons

### 7. Activate a partner
- Click any partner name to open editor
- Change status from `onboarding` to `active`
- Click "Update Partner"
- Green toast: "Partner saved"
- Go back to Overview → Active count = 1

### 8. Test search
- Type "bajaj" in search bar → only Bajaj Finance shows
- Type "unilever" → only Hindustan Unilever shows

### 9. Test filters
- Click "nbfc" type pill → only NBFC partners show
- Click "active" status pill → only active partners show
- Combine: "fintech" type + "onboarding" status → shows onboarding fintech partners

### 10. Test delete
- Click trash icon on any partner
- Confirmation dialog: `Delete "X"? This cannot be undone.`
- Click OK → partner deleted, green toast shown

### 11. Verify audit trail
- Go to **Audit Log** page (`/audit-log`)
- See `partner_create`, `partner_update`, `partner_delete` actions

### 12. Verify pagination
- Create 25+ partners
- Pagination controls appear at bottom of list tab

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (7 parallel count + aggregate + groupBy queries) |
| List tab | ~100ms (findMany with take=20 + count) |
| Polling | None (60s staleTime) |
| Cache | 60s (overview), 30s (list) |

## Partner Lifecycle

```
onboarding → active → inactive → terminated
```

| Status | Color | Meaning |
|--------|-------|---------|
| onboarding | Blue (info) | Contract being negotiated, integration in progress |
| active | Green (success) | Live partner, leads/data being sent |
| inactive | Grey (neutral) | Temporarily paused (contract still valid) |
| terminated | Red (danger) | Contract ended, no more business |

## Integration Points

This feature connects to:
- **Data Monetization** (`/data`): Credit scores → NBFC partners (lending leads)
- **API Key Management** (Phase 2.8 — future): Partner API keys for authentication
- **Webhook Management** (Phase 2.9 — future): Send lead notifications to partner webhook URLs
- **Revenue Recognition** (Phase 2.10 — future): Track partner revenue for financial reporting

## DPDP Compliance Reminder

Before sharing any user data with partners:
1. Get **explicit consent** from users (in main app settings)
2. Allow **revocation** at any time
3. Share **anonymized data** where possible
4. Maintain **audit trail** of all data shared
5. Report **breaches within 72 hours** (DPDP Act 2025)
