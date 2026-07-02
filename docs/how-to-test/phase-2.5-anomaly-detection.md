# Phase 2 (5/22) — Anomaly Detection

**Page URL:** `/anomalies`
**Sidebar location:** Intelligence group → Anomaly Detection (activity icon)
**Commit:** `2a4e186`

## What This Feature Does

Auto-detect metric spikes/drops using z-score statistics:
- 7 tracked metrics: new_signups, revenue, ai_cost, ai_calls, failed_logins, new_transactions, support_tickets
- Algorithm: 30-day baseline → compute mean (μ) + stdDev (σ) → z-score = (current - μ) / σ
- Threshold: |z| > 2.5 = anomaly
- Severity: low (2.5-3), medium (3-4), high (4-5), critical (5+)
- Deduplication: skips if same metric already open in last 24h
- Admin can acknowledge (reviewing) or resolve with note (fixed/false-positive)
- Production: should run via daily cron (e.g. 2 AM IST)

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Intelligence** group in sidebar (orange brain icon)
- Click **Anomaly Detection** (activity icon, 3rd item)

### 2. Overview tab (default)
- 4 KPI cards: Open (0), Acknowledged (0), Resolved (0), Total (0)
- **Open Anomalies by Metric** card — "No open anomalies" initially
- **Tracked Metrics (7 metrics)** card — shows all 7 metrics with descriptions and good/bad direction badges:
  - New User Signups (↑ Good)
  - Daily Revenue (↑ Good)
  - AI Cost ₹ (↓ Good)
  - AI API Calls (↓ Good)
  - Failed Login Attempts (↓ Good)
  - New Transactions (↑ Good)
  - New Support Tickets (↓ Good)
- **"How anomaly detection works"** transparency card

### 3. Run detection
- Click **"Run Detection"** button (top-right)
- Button shows spinner: "Detecting..."
- After 2-10 seconds, green toast:
  > "Detection complete — 7 metrics checked in X.Xs"
  > Description: "No new anomalies." OR "X new anomaly(s) detected!"
- 5-minute cooldown starts (button shows countdown)

### 4. View detected anomalies
- If anomalies detected, switch to **"All Anomalies"** tab
- Each anomaly shows:
  - Direction icon: ↑ spike (red) or ↓ drop (blue)
  - Metric label (e.g. "New User Signups")
  - Severity badge: low / medium / high / critical
  - Status badge: open (red)
  - Z-score value
  - Current value vs Baseline value vs Std Dev
  - Detected time (e.g. "5m ago")
- Action buttons for open anomalies: **Acknowledge** + **Resolve with Note**

### 5. Test acknowledge
- Click **"Acknowledge"** on any open anomaly
- Green toast: "Anomaly updated"
- Anomaly status changes from `open` (red) to `acknowledged` (amber)

### 6. Test resolve with note
- Click **"Resolve with Note"** on any anomaly
- Modal opens (white background)
- Type: `False positive — expected surge due to marketing campaign`
- Click **"Resolve"**
- Green toast: "Anomaly updated"
- Anomaly status changes to `resolved` (green)
- Your note appears below the anomaly details

### 7. Test filters
- Click "open" status pill → shows only open anomalies
- Click "critical" severity pill → shows only critical anomalies
- Use metric dropdown to filter by specific metric (e.g. "AI Cost ₹")

### 8. Verify audit trail
- Go to **Audit Log** page (`/audit-log`)
- See `anomaly_detection_run` action with metrics checked + new anomalies count
- See `anomaly_status_change` actions for acknowledge/resolve

### 9. Test deduplication
- Run detection again (after 5-min cooldown)
- If same anomaly still exists (status=open, detected in last 24h), it won't be duplicated
- Only genuinely new anomalies are created

### 10. Note on first run
- On first run with fresh database, you may see "No new anomalies" because:
  - Baseline needs at least 7 days of data
  - If app is new, there may not be enough historical data yet
- As app grows and accumulates 30+ days of data, detection becomes more accurate

## Z-Score Statistics Explained

```
z-score = (current_value - baseline_mean) / baseline_stddev
```

- **Baseline**: last 30 days of daily values for each metric
- **Mean (μ)**: average of baseline values
- **Standard Deviation (σ)**: how much values vary from the mean
- **Z-score**: how many standard deviations the current value is from the mean

### Interpretation

| Z-Score | Severity | Meaning |
|---------|----------|---------|
| < 2.5 | Normal | Within expected range |
| 2.5 - 3.0 | Low | Slightly unusual |
| 3.0 - 4.0 | Medium | Statistically significant anomaly |
| 4.0 - 5.0 | High | Strong anomaly |
| 5.0+ | Critical | Extreme anomaly (5σ event) |

## 7 Tracked Metrics

| Metric | Direction | Description | Concerning When |
|--------|-----------|-------------|-----------------|
| new_signups | ↑ Good | Daily new user registrations | Drop (fewer signups) |
| revenue | ↑ Good | Sum of subscription amounts per day | Drop (revenue loss) |
| ai_cost | ↓ Good | Daily AI API costs in INR | Spike (cost overrun) |
| ai_calls | ↓ Good | Daily AI API call count | Spike (abuse/bug) |
| failed_logins | ↓ Good | Daily failed login count | Spike (brute force) |
| new_transactions | ↑ Good | Daily transaction count | Drop (engagement loss) |
| support_tickets | ↓ Good | Daily support ticket count | Spike (user frustration) |

## Performance at Scale

| Metric | Value |
|--------|-------|
| Detection time (7 metrics) | 2-10 seconds |
| Query strategy | Raw SQL `GROUP BY` per metric (single query each) |
| Timeout | 10s per metric (longer than 5s — raw SQL can be slower) |
| Cooldown | 5 minutes between manual detections |
| Production | Should run via daily cron (2 AM IST) |
