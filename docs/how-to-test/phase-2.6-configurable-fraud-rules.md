# Phase 2 (6/22) — Configurable Fraud Rules

**Page URL:** `/fraud-rules`
**Sidebar location:** System group → Fraud Rules (shield alert icon)
**Commit:** `df5b5a7`

## What This Feature Does

Admin-defined fraud detection rules that auto-generate alerts:
- 5 metric types: transaction_count, transaction_amount, ai_call_count, login_failure_count, new_user_with_activity
- 5 operators: gt, gte, lt, lte, eq
- Configurable time window (minutes) + user age filter (for bot detection)
- Severity levels: low, medium, high, critical
- Alert lifecycle: open → acknowledged → resolved | false_positive
- Uses bulk `groupBy` for evaluation (10 queries for 10 rules, not 10M queries)
- Deduplication: skips if alert already open for user+rule
- Production: should run via cron every 15 minutes

## How to Test

### 1. Open the page
- Login to admin panel
- Find **System** group in sidebar (slate shield icon)
- Click **Fraud Rules** (shield alert icon, 3rd item)

### 2. Overview tab (default)
- 4 KPI cards: Active Rules (0), Open Alerts (0), Critical Open (0), Total Rules (0)
- **"How fraud rules work"** transparency card explaining 5 metric types + evaluation strategy

### 3. Create your first rule
- Click **"+ New Rule"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Name**: `Excessive Transactions (1 hour)`
  - **Description**: `Flag users with > 50 transactions in 1 hour (possible bot)`
  - **Metric**: `Transaction Count`
  - **Operator**: `Greater than (>)`
  - **Threshold**: `50`
  - **Time Window (minutes)**: `60`
  - **Severity**: `high`
  - **Enabled**: `Enabled (active)`
- Click **"Create Rule"**
- Green toast: "Rule created"

### 4. Create a second rule — bot detection
- Click "+ New Rule" again
- Fill in:
  - **Name**: `New User Bot Detection`
  - **Metric**: `New User with High Activity`
  - **Operator**: `Greater than (>)`
  - **Threshold**: `10`
  - **Time Window**: `60`
  - **User Age (minutes)**: `60` (required for this metric — note red "Required for this metric" text)
  - **Severity**: `critical`
- Create

### 5. View in Rules tab
- Switch to "All Rules" tab
- See 2 rules with:
  - Condition shown as code: `Transaction Count > 50` / `New User with High Activity > 10`
  - Window: `1h` / `1h` (with "user age < 1h" subtitle for bot rule)
  - Severity badges
  - **Green toggle switch** (enabled) — click to disable/enable inline
  - Open Alerts: 0
  - Edit button

### 6. Test toggle
- Click the green toggle on any rule
- Should turn grey (disabled)
- Green toast: "Rule updated"
- Click again to re-enable

### 7. Run evaluation
- Click **"Evaluate Now"** button (top-right, green)
- Button shows spinner
- After 2-10 seconds, green toast:
  > "Evaluation complete — 2 rules checked in X.Xs"
  > Description: "No new alerts." OR "X new alert(s) created!"
- 5-minute cooldown starts

### 8. View alerts (if any)
- Switch to "Fraud Alerts" tab
- If alerts were created, each shows:
  - Triangle icon (red for critical, amber for high)
  - Rule name + severity badge + status badge (open = red)
  - Metric value vs threshold (e.g. "Value: 75 vs threshold: 50")
  - User link (click → `/users/[id]`)
  - Detected time
  - Action buttons: **Acknowledge** / **Resolve** / **False Positive**

### 9. Test acknowledge
- Click "Acknowledge" on any open alert
- Green toast: "Alert updated"
- Status changes from `open` (red) to `acknowledged` (amber)

### 10. Test resolve with note
- Click "Resolve" on any alert
- Modal opens (white background)
- Type: `Investigated — legitimate bulk upload`
- Click "Confirm"
- Green toast: "Alert updated"
- Status changes to `resolved` (green)
- Your note appears below the alert

### 11. Test false positive
- Click "False Positive" on any open alert
- Modal opens
- Type: `User was running a legitimate promotion`
- Confirm
- Status changes to `false_positive` (grey)

### 12. Test filters
- Click "open" status pill → shows only open alerts
- Click "critical" severity pill → shows only critical alerts
- Combine both → shows critical open alerts

### 13. Verify audit trail
- Go to **Audit Log** page
- See `fraud_rule_create`, `fraud_rule_update` (toggle), `fraud_rules_evaluation`, `fraud_alert_status_change` actions

## 5 Metric Types

| Metric | Description | Example Use Case |
|--------|-------------|------------------|
| transaction_count | COUNT of transactions per user in time window | Bot detection (> 50 txns in 1 hour) |
| transaction_amount | SUM of transaction amounts per user in time window | Money laundering (> ₹1L in 24 hours) |
| ai_call_count | COUNT of AI usage logs per user in time window | AI abuse (> 20 calls in 1 hour) |
| login_failure_count | COUNT of failed logins per IP in time window | Brute force (> 10 fails in 1 hour) |
| new_user_with_activity | New users (created < X min) with > threshold txns | Bot account creation (created < 1 hour, > 10 txns) |

## 5 Operators

| Operator | Symbol | Meaning |
|----------|--------|---------|
| gt | > | Greater than |
| gte | ≥ | Greater than or equal |
| lt | < | Less than |
| lte | ≤ | Less than or equal |
| eq | = | Equal to |

## Alert Lifecycle

```
open → acknowledged → resolved
                    ↘ false_positive
```

| Status | Color | Meaning |
|--------|-------|---------|
| open | Red | New alert, needs investigation |
| acknowledged | Amber | Admin is reviewing |
| resolved | Green | Fixed or confirmed legitimate |
| false_positive | Grey | Not actually fraud (rule too sensitive) |

## Performance at Scale

| Metric | Value |
|--------|-------|
| Evaluation time (10 rules) | 2-10 seconds |
| Query strategy | Bulk `groupBy` (10 queries for 10 rules, not 10M) |
| Timeout | 10s per rule (one failure doesn't stop others) |
| Cooldown | 5 minutes between manual evaluations |
| Deduplication | Same user+rule only alerted once until resolved |
| Production | Should run via cron every 15 minutes |

## Example Rules

| Name | Metric | Op | Threshold | Window | Severity |
|------|--------|----|-----------|--------|----------|
| Excessive Transactions | transaction_count | > | 50 | 60 min | high |
| Large Transaction Amount | transaction_amount | > | 100000 | 1440 min | critical |
| AI Abuse | ai_call_count | > | 20 | 60 min | medium |
| Brute Force Login | login_failure_count | > | 10 | 60 min | high |
| New User Bot | new_user_with_activity | > | 10 | 60 min + userAge 60 | critical |
