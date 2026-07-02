# Phase 2 (15/22) — Audit Log Explorer

**Page URL:** `/audit-log`
**Sidebar location:** System group → Audit Log (scroll text icon)
**Commit:** `pending`

## What This Feature Does

Searchable, filterable audit trail — every admin action permanently recorded:
- **Overview tab**: KPIs (today/week/month/all-time) + top actions + top target types
- **All Actions tab**: server-side search + action type filter + target type filter + date range
- **Expandable rows**: click to see full metadata (before/after values, IP, user agent)
- **DPDP compliant**: logs cannot be deleted, required for security forensics + investor due diligence

## What Changed (vs old audit log)

| Old | New |
|-----|-----|
| `findMany(take: 500)` — loads ALL 500 into memory | `findMany(skip, take: 20)` — paginated server-side |
| JS-side search + filter (doesn't scale) | DB-side search + filter (scales to millions) |
| No overview/stats | Overview tab with KPIs + top actions + target types |
| No date range filter | Date range (from/to) |
| No target type filter | Filter by user/feature/subscription/campaign/etc. |
| No resilience wrappers (DB sleep crash) | `withNeonRetry` + `withTimeout` on all queries |
| Not using design system | Full design system (PageHeader, KPIGrid, ContentCard, etc.) |

## How to Test

### 1. Open the page
- Login → System group → **Audit Log** (scroll text icon)

### 2. Overview tab (default)
- 4 KPI cards: Actions Today, This Week, This Month, Total (all time)
- **Top Actions (Last 30 Days)** card — horizontal bar chart of most common actions
- **Top Target Types** card — grid showing what entities are most affected
- Amber compliance note about DPDP + permanence

### 3. Click "All Actions" tab
- **Search bar**: search by description, admin email, or action type (server-side)
- **Action filter dropdown**: filter by specific action type (shows count per type)
- **Target type filter dropdown**: filter by user/feature_flag/subscription/campaign/etc.
- **Date range**: from date + to date pickers + "Clear dates" button
- Results: expandable list of audit entries

### 4. Test search
- Type "partner" in search bar → all partner-related actions show
- Type "create" → all creation actions show
- Server-side: works even with millions of entries

### 5. Test filters
- Select "competitor_create" in action dropdown → only competitor creation actions
- Select "user" in target type dropdown → only user-related actions
- Combine: action="partner_create" + target="partner" → very specific

### 6. Test date range
- Set "from" to yesterday → shows only actions since yesterday
- Set "to" to last week → shows only actions before last week
- Click "Clear dates" → removes date filter

### 7. Expand metadata
- Click any row with ▶ arrow → expands to show JSON metadata
- Metadata includes: before/after values, SQL queries, counts, durations
- Click again to collapse

### 8. Test pagination
- If >20 actions match, pagination appears at bottom
- Click page 2, 3 → next 20 actions load

### 9. Verify all admin actions are logged
- Go to any other admin page (e.g. Partners) → create/edit/delete something
- Come back to Audit Log → your action appears at the top
- Expand the row → see metadata with what changed

## Filter Options

### Action Types (auto-populated from DB)
- `user_plan_change`, `user_ban`, `feature_toggle`
- `partner_create`, `partner_update`, `partner_delete`
- `api_key_create`, `api_key_update`, `api_key_delete`
- `webhook_create`, `webhook_update`, `webhook_delete`
- `campaign_create`, `campaign_start`, `campaign_cancel`
- `experiment_create`, `experiment_update`
- `competitor_create`, `competitor_update`, `competitor_delete`
- `incident_create`, `incident_update`
- `anomaly_detection_run`, `fraud_rules_evaluation`
- `database_query`, `database_export`
- `notification_send`, `notification_template_create`
- ... and more (all actions from all features)

### Target Types
- `user`, `feature_flag`, `subscription`, `campaign`
- `notification_template`, `incident`, `partner`
- `api_key`, `webhook_endpoint`, `experiment`
- `competitor`, `fraud_rule`, `anomaly`
- `database`, `null` (no target)

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (6 parallel count + groupBy) |
| List tab | ~100ms (findMany with take=20 + count + groupBy for action types) |
| Search | Server-side (scales to millions of entries) |
| Cache | 60s (overview), 30s (list) |
