# Phase 3 (1/5) — Predictive Churn Model

**Page URL:** `/churn-predictions`
**Sidebar location:** Growth group → Churn Predictions (trending down icon)
**Commit:** `pending`

## What This Feature Does

ML-based churn prediction — identifies users at risk of cancelling before they do:
- **6 risk factors** (weighted): inactivity, engagement, AI usage decline, support tickets, plan tier, account age
- **Risk score** (0-100) per user with weighted average of all factors
- **4 risk levels**: low (0-25), medium (26-50), high (51-75), critical (76-100)
- **Recommended actions** per risk level (personal outreach, win-back campaign, monitor, none)
- **Top 2 factors** shown per user (what's driving their risk)
- Bulk groupBy queries (not per-user) — scales to millions
- 5-minute cooldown between manual computations

## 6 Risk Factors + Weights

| Factor | Weight | What it measures |
|--------|--------|------------------|
| Inactivity | 25% | Days since last login (updatedAt) |
| Engagement | 25% | Days since last transaction |
| AI Usage Decline | 15% | Last 7 days AI calls vs previous 7 days |
| Support Tickets | 15% | Open support ticket count |
| Plan Tier | 10% | Free users = higher baseline risk |
| Account Age | 10% | Very new (<7d) or old (>365d) = higher risk |

## Risk Levels + Recommendations

| Level | Score | Action |
|-------|-------|--------|
| Critical | 76-100 | Personal outreach + offer discount (50% off Pro for free users, free month for paid) |
| High | 51-75 | Send win-back campaign (SMS + email with usage tips) |
| Medium | 26-50 | Monitor for 7 days + send re-engagement notification |
| Low | 0-25 | No action needed |

## How to Test

### 1. Open the page
- Login → Growth group → **Churn Predictions** (trending down icon, 3rd item)

### 2. Overview tab (default)
- Amber banner: "No predictions yet" (first visit)
- 4 KPI cards: At Risk (High + Critical), Critical Risk, High Risk, Total Analyzed
- **Risk Distribution** card — 4 colored cards (low/medium/high/critical) with count + %
- "How churn prediction works" transparency card

### 3. Run prediction (CRITICAL FIRST STEP)
- Click **"Run Prediction"** (top-right)
- Spinner: computing...
- After 2-30 seconds (depending on user count), green toast:
  > "Computed predictions for X users in Y.Ys"
  > Critical: A · High: B · Medium: C · Low: D
- 5-minute cooldown starts

### 4. After compute — verify Overview
- Blue banner: "Predictions last computed Xm ago. X users analyzed. Y% at risk."
- KPI cards now show actual counts
- Risk distribution shows percentages

### 5. Click "At-Risk Users" tab
- Risk filter pills: All / Critical / High / Medium / Low
- Plan filter pills: All / Free / Pro / Elite
- Table: User (name+email, links to /users/[id]), Risk Score (/100), Level badge, Plan badge, Top 2 Factors (with progress bars), Recommendation
- Sorted by risk score descending (highest risk first)

### 6. Test filters
- Click "critical" → only critical-risk users show
- Click "free" plan → only free users show
- Combine: "high" + "free" → free users at high risk

### 7. View top factors
- Each user shows their top 2 contributing factors with colored progress bars
- Red ≥75, amber ≥50, green <50
- Example: "Inactive 90" + "No Txns 85" = high risk driven by inactivity + no transactions

### 8. Click user name
- Navigates to `/users/[id]` detail page

### 9. Verify recommendations
- Critical users: "Personal outreach + offer 50% off Pro..."
- High users: "Send win-back campaign..."
- Medium users: "Monitor for 7 days..."
- Low users: "No action needed"

### 10. Verify audit trail
- Audit Log → `churn_prediction_compute` action

## Performance at Scale

| Metric | Value |
|--------|-------|
| Compute (1K users) | ~5-10 seconds |
| Compute (100K users) | ~30-60 seconds (chunked at 500) |
| Overview tab | ~100ms (6 parallel count) |
| List tab | ~100ms (findMany with take=20 + count) |
| Cooldown | 5 minutes between manual computes |
| Production | Should run daily via cron |
