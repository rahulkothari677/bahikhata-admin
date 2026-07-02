# Phase 2 (20/22) — Data Export Center

**Page URL:** `/data-exports`
**Sidebar location:** System group → Data Exports (file bar chart icon)
**Commit:** `pending`

## What This Feature Does

GDPR/DPDP-compliant data exports:
- 6 export types: single user data, all users, transactions, subscriptions, AI usage, custom SQL
- CSV format with proper escaping
- Max 10,000 rows per export (prevents memory exhaustion)
- Auto-generate on request (file downloads immediately)
- 24-hour link expiry
- All exports logged to AdminAction audit trail
- Custom queries use safe query runner (SELECT only, blocked keywords)

## 6 Export Types

| Type | Description | Use Case |
|------|-------------|----------|
| `user_data` | Single user's complete data (profile + transactions + products + parties) | DPDP data portability request |
| `all_users` | All users list (id, email, name, phone, plan, dates) | Migration / analysis |
| `transactions` | All transactions (last 10,000) | Accounting / audit |
| `subscriptions` | All subscription records | Revenue analysis |
| `ai_usage` | AI usage logs (last 10,000) | Cost analysis |
| `custom` | Custom SQL query export (validated) | Flexible ad-hoc export |

## How to Test

### 1. Open the page
- Login → System group → **Data Exports** (file bar chart icon, 7th item)

### 2. Overview tab (default)
- 4 KPI cards: Pending, Completed, Failed, Total Rows Exported
- "How data exports work" transparency card with 6 types + compliance info

### 3. Create an export — All Users
- Click **"+ New Export"**
- Modal opens (white background)
- Export Type: `All Users`
- Format: `CSV` (default)
- Click "Generate Export"
- Green toast: "Export requested — generating now..."
- File downloads automatically to your computer
- File name: `all_users_YYYY-MM-DD.csv`

### 4. Create an export — Transactions
- Click "+ New Export"
- Type: `Transactions`
- Click "Generate Export"
- File downloads: `transactions_YYYY-MM-DD.csv`

### 5. Create an export — Single User Data
- Click "+ New Export"
- Type: `Single User Data`
- User ID: paste a user ID from the Users page
- Click "Generate Export"
- File downloads with: user profile + transactions + products + parties sections

### 6. Create an export — Custom SQL
- Click "+ New Export"
- Type: `Custom SQL Query`
- SQL: `SELECT plan, COUNT(*) as count FROM "User" GROUP BY plan`
- Click "Generate Export"
- File downloads with query results

### 7. View in List tab
- Switch to "All Exports" tab
- See all export requests with: type, status badge, format, file name, row count, file size, created time
- Pending exports have "Generate" button
- All exports have delete button

### 8. Test filters
- Click "completed" → only completed exports
- Click "pending" → only pending exports

### 9. Verify audit trail
- Audit Log → `data_export_request`, `data_export_complete` actions

## Compliance

- **GDPR Article 20**: Right to data portability — users can request their data in machine-readable format
- **DPDP Act**: Right to access personal data — users can see what data we hold about them
- **Audit trail**: All export requests + completions logged to AdminAction
- **Link expiry**: Download links expire after 24 hours
- **Safe query runner**: Custom exports validated (SELECT only, 15 blocked keywords)

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (5 parallel count + aggregate) |
| List tab | ~100ms (findMany with take=20 + count) |
| Export generation | Variable (depends on data volume) |
| Max rows per export | 10,000 |
| Link expiry | 24 hours |
