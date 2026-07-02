# Phase 2 (17/22) — Feature Flag Analytics

**Page URL:** `/features`
**Sidebar location:** System group → Feature Flags (flag icon)
**Commit:** `pending`

## What This Feature Does

Feature flags with adoption analytics:
- **Overview tab**: KPIs (enabled/disabled/total/toggles-30d) + recent toggle history (last 10 changes)
- **All Flags tab**: searchable list with toggle count per flag + inline toggle switches
- Toggle history from AdminAction audit log (who toggled what, when, before/after)
- No new schema — uses existing FeatureFlag + AdminAction models

## What Changed (vs old feature flags page)

| Old | New |
|-----|-----|
| Single flat list, no overview | 2 tabs: Overview + All Flags |
| No analytics/stats | KPI cards + toggle count per flag + recent history |
| JS-side search only | Same (small dataset — fine) |
| Not using design system | Full design system (PageHeader, KPIGrid, etc.) |
| No resilience wrappers | withNeonRetry + withTimeout |

## How to Test

### 1. Open the page
- Login → System group → **Feature Flags** (flag icon)

### 2. Overview tab (default)
- 4 KPI cards: Enabled Flags, Total Flags, Toggles (30 days), Disabled
- **Recent Toggle History** card — last 10 flag changes with admin name + time
- Blue info card about feature flags usage

### 3. Click "All Flags" tab
- Search bar
- List of flags with: key (code), ENABLED/DISABLED badge, toggle count badge, label, description, last updated
- Toggle switch on right — click to enable/disable
- Green toast: "X is now ENABLED/DISABLED"

### 4. Toggle a flag
- Click any toggle switch
- Green toast confirms
- Flag status changes immediately
- Go to Overview tab → recent toggle history shows your change

### 5. Create a new flag
- Click "+ New Flag"
- Fill in: Key (`test_flag`), Label (`Test Feature`), Description
- Click "Create Flag"
- Green toast: "Feature flag created"

### 6. Search
- Type in search bar → filters by key or label

### 7. Verify toggle count
- Toggle a flag 3 times
- Go to All Flags tab → see toggle count badge increment

### 8. Verify audit trail
- Audit Log page → `feature_toggle` actions with before/after metadata

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (4 count + 2 findMany/groupBy) |
| List tab | ~100ms (findMany + groupBy for toggle counts) |
| Cache | 60s (overview), 30s (list) |
