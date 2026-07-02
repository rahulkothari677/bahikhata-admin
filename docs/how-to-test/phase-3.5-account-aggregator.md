# Phase 3 (5/5) — Account Aggregator

**Page URL:** `/account-aggregator`
**Sidebar location:** Intelligence group → Account Aggregator (landmark icon)
**Commit:** `pending`

## What This Feature Does

India's Account Aggregator (AA) framework integration for bank data access:
- Request bank data consent from users (via AA providers like OneMoney, FinVu)
- Fetch financial data (income, balances, transactions) from 8 supported banks
- Simulation mode: auto-approves consent + generates mock bank data for testing
- Production mode: requires AA provider env vars (AA_BASE_URL, AA_CLIENT_ID, AA_CLIENT_SECRET)
- Search any user's financial data by user ID
- Revenue: charge NBFCs ₹50-100 per verified financial report

## 8 Supported Banks

| FIP ID | Bank Name |
|--------|-----------|
| HDFC | HDFC Bank |
| ICICI | ICICI Bank |
| SBI | State Bank of India |
| AXIS | Axis Bank |
| KOTAK | Kotak Mahindra Bank |
| YES | Yes Bank |
| PNB | Punjab National Bank |
| BOB | Bank of Baroda |

## How to Test

### 1. Open the page
- Login → Intelligence group → **Account Aggregator** (landmark icon, 5th item)

### 2. Simulation mode banner
- Amber banner: "Simulation Mode — No AA provider configured"
- Mock bank data will be generated for testing

### 3. Overview KPIs
- 4 KPI cards: Consent Requests, Data Received, Users with Consent, Supported Banks (8)
- **Supported Banks** card — 8 bank cards with FIP IDs

### 4. Request consent
- Click **"Request Consent"** (top-right)
- Modal opens: enter User ID (from Users page) + purpose
- Click "Request Consent"
- Green toast: "Consent requested — Consent auto-approved (simulation mode)"
- Mock bank data generated immediately

### 5. Search user financial data
- In "Search User Financial Data" card, enter the same user ID
- Click search → financial data appears:
  - Bank name + masked account number (XXXX1234)
  - Estimated Monthly Income (₹)
  - Average Monthly Balance (₹)
  - Total Credits (3 months)
  - Total Debits (3 months)
  - Transaction count
  - Consent ID
  - Data received timestamp

### 6. Verify audit trail
- Audit Log → `aa_consent_request` action

### 7. Enable production mode (future)
- Set env vars: `AA_BASE_URL`, `AA_CLIENT_ID`, `AA_CLIENT_SECRET`, `AA_FIU_ID`
- Banner changes to green: "Production Mode — AA provider connected"
- Real bank data will be fetched with user consent

## AA Flow (Production)

```
1. Admin requests consent → AA provider API
2. User receives notification in AA app
3. User approves consent
4. AA sends webhook to us (consent approved)
5. We request financial data from AA
6. AA fetches from bank (Financial Information Provider)
7. AA returns encrypted financial data
8. We decrypt + store + display
```

## Revenue Model

- Charge NBFC partners ₹50-100 per verified financial report
- Use for: credit scoring (verify income), lending (NBFC verification), GST cross-check
- RBI-regulated: data encrypted, consent-based, user can revoke at any time

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (2 parallel count + groupBy) |
| User data search | ~100ms (findMany with filter) |
| Consent request (simulation) | ~200ms (generate mock data) |
| Consent request (production) | ~500ms (AA API call) |
| Cache | 60s (overview), 30s (user data) |
