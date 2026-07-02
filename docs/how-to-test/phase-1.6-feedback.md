# Phase 1.6 (5/5) — Feedback (NPS)

**Page URL:** `/feedback`
**Sidebar location:** Growth group → Feedback (NPS) (message icon)
**Commit:** `ac87ec3`

## What This Feature Does

Net Promoter Score feedback:
- NPS score banner (color-coded: green ≥+50, amber 0 to +49, red <0)
- 4 KPI cards: Total Responses, Average Score, Promoters, Detractors
- Score distribution card (0-10 scale with colored bars)
- All Feedback tab: paginated list with category filter (Promoters/Passives/Detractors)
- NPS computed from DB-side `count()` (was JS filter on first 50 only — BUGGY before)

## How to Test

### 1. Open the page
- Login to admin panel
- Click **Feedback (NPS)** in the sidebar (Growth group, message icon)

### 2. Overview tab (default)
- At top: **NPS Score banner** — large colored number (green ≥+50, amber 0 to +49, red <0) with label
- 4 KPI cards:
  - Total Responses (count + "X new in last 7 days")
  - Average Score (X/10)
  - Promoters (9-10) (count + % of total)
  - Detractors (0-6) (count + % of total)
- **Score Distribution** card — 11 rows (scores 0-10), each with:
  - Colored score badge (red 0-6, amber 7-8, green 9-10)
  - Category label (Detractor/Passive/Promoter)
  - Count of responses
  - Colored progress bar (relative to max score's count)
- Blue **NPS explainer** card (formula + scale interpretation)
- **"How data is computed"** transparency card at bottom

### 3. Click "All Feedback" tab
- Top: search bar + 4 category filter pills (All / Promoters / Passives / Detractors) with icons
- Below: paginated list (20 per page) of feedback entries:
  - Left: colored score badge (large number 0-10)
  - Middle: user name (click → `/users/[id]`) + category badge + plan badge + feedback quote (italic) + time ago

### 4. Test search
- Type "slow" in search bar → filters by feedback text OR user email/name (server-side)

### 5. Test category filter
- Click "Promoters" → only 9-10 scores show
- Click "Detractors" → only 0-6 scores show
- Click "All" → back to all feedback

### 6. Test pagination
- If >20 feedback entries match, pagination appears at bottom

### 7. Verify NPS bug is fixed
- Old code: only counted first 50 responses → NPS was wrong if >50 existed
- New code: uses `count()` on ALL responses → NPS is always correct
- Check: NPS score on overview tab should match the formula (% promoters − % detractors)

### 8. If no feedback exists yet
- Overview: NPS = 0, all KPIs show 0, score distribution shows "No feedback yet"
- List tab: "No feedback collected yet"
- No crashes, no white screen

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (6 parallel count/aggregate/groupBy queries) |
| List tab | ~100ms (findMany with take=20 + count) |
| NPS accuracy | Correct (was computed from first 50 only before — BUG) |
| Polling | None |
| Cache | 60s staleTime |

## NPS Formula

```
NPS = % Promoters (9-10) − % Detractors (0-6)
```

- Score range: -100 to +100
- 50+ = Excellent (world-class)
- 0-49 = Good (room to improve)
- Below 0 = Needs attention

To collect feedback: add an NPS survey widget to the main app.
