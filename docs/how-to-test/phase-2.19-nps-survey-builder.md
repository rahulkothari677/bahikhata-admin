# Phase 2 (19/22) — NPS Survey Builder

**Page URL:** `/nps-config`
**Sidebar location:** Growth group → NPS Survey Builder (star icon)
**Commit:** `pending`

## What This Feature Does

Configurable NPS survey triggers — define when surveys appear to users:
- 5 trigger types: days after signup, transaction count, days since last survey, plan upgrade, manual
- Cooldown protection: don't re-show for X days after response (default: 90)
- Target by plan: all, free, pro, or elite
- Priority: higher = shown first if multiple triggers match
- Stats per config: times shown, times responded, response rate
- All actions logged to AdminAction audit trail

## 5 Trigger Types

| Trigger | Description | Example |
|---------|-------------|---------|
| `days_after_signup` | Show X days after account creation | Show after 7 days |
| `transaction_count` | Show after Xth transaction | Show after 10th transaction |
| `days_since_last_survey` | Re-survey if last survey was > X days ago | Re-survey after 90 days |
| `plan_upgrade` | Show immediately when user upgrades plan | Show on upgrade to Pro |
| `manual` | Only when admin triggers via bulk job | Manual one-off survey |

## How to Test

### 1. Open the page
- Login → Growth group → **NPS Survey Builder** (star icon, between Feedback and A/B Testing)

### 2. Overview tab (default)
- 4 KPI cards: Active Configs (0), Times Shown (0), Times Responded (0), Response Rate (0%)
- "How NPS survey triggers work" transparency card

### 3. Create a survey config
- Click **"+ New Survey Config"**
- Modal opens (white background)
- Fill in:
  - **Name**: `7-Day Onboarding Survey`
  - **Trigger Type**: `Days After Signup`
  - **Trigger Value**: `7`
  - **Survey Question**: default (leave as is)
  - **Cooldown (days)**: `90`
  - **Target Plans**: `All Plans`
  - **Priority**: `1`
  - **Enabled**: checked
- Click "Create Config"
- Green toast: "Config saved"

### 4. Create a second config — transaction-based
- **Name**: `Power User Survey`
- **Trigger Type**: `Transaction Count`
- **Trigger Value**: `50`
- **Cooldown**: `180`
- **Target Plans**: `All Plans`
- **Priority**: `2` (higher priority)
- Create

### 5. View in List tab
- Switch to "All Configs" tab
- See 2 configs with: name, enabled/disabled badge, trigger type badge, priority badge, trigger description, cooldown, target, stats

### 6. Edit a config
- Click pencil icon → modal opens with pre-filled values
- Change cooldown from 90 to 120
- Click "Update Config"
- Green toast: "Config saved"

### 7. Delete a config
- Click trash icon → confirm → deleted

### 8. Verify audit trail
- Audit Log → `nps_config_create`, `nps_config_update`, `nps_config_delete` actions

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (4 parallel count + aggregate) |
| List tab | ~50ms (findMany — typically <10 configs) |
| Cache | 60s (overview), 30s (list) |
