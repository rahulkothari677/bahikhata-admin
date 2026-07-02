# Phase 1.5 — Credit Scoring (Data Monetization)

**Page URL:** `/data`
**Sidebar location:** Intelligence group → Data Monetization (database icon)
**Commit:** `6ffed4b`

## What This Feature Does

Credit scoring for lending pipeline:
- Computes credit scores (300-900 scale, CIBIL-style) for all users with transactions
- Uses 5-factor model: transaction volume, collection rate, product diversity, party base, transaction consistency
- Caches scores in `CreditScoreCache` table for instant page loads
- Background job computes scores using 5 bulk `groupBy` queries (not N+1)
- Shows lending revenue potential (₹200/₹150/₹100 per lead by band)

## How to Test

### 1. Open the page
- Login to admin panel
- Click **Data Monetization** in the sidebar (under "Intelligence" group, database icon)

### 2. First visit — cache is empty
- You should see an **amber banner**: "Credit score cache is empty"
- The 4 KPI cards should still show numbers (these come from live bulk compute as fallback)
- The "Top Lending Candidates" table should show: "Cache is empty — Click Recompute Scores to populate"
- The "Recompute Scores" button (top-right) should be blue and clickable

### 3. Click "Recompute Scores"
- Button turns into spinner: "Computing..."
- After 1-10 seconds (depending on user count), green toast:
  > ✓ Computed X scores in Y.Ys
  > Excellent: A · Good: B · Fair: C · Poor: D
- Page auto-refreshes with new data

### 4. After compute — verify KPI cards
- **Total Scored Users** → matches toast count
- **Average Score** → number between 300-900
- **Lending Revenue Potential** → ₹X (sum of excellent×200 + good×150 + fair×100)
- **Excellent Band Users** → matches toast "Excellent" count

### 5. Verify "Score Distribution by Band" card
- 4 horizontal progress bars: Excellent (green), Good (blue), Fair (amber), Poor (red)
- Each shows: label, score range, ₹/lead, count, and % of total
- Bars proportional to counts

### 6. Verify "Top Lending Candidates" table
- Up to 20 rows (page 1 of X)
- Sorted by score descending (highest = #1)
- Each row: rank, user ID (truncated), score/900, band badge, monthly sales ₹, collection %, business age
- Collection % color: green ≥85%, amber ≥70%, red <70%

### 7. Test band filter pills (above table)
- Click **Excellent** → only excellent-band users
- Click **Good** → only good-band users
- Click **All** → back to all users

### 8. Test pagination
- If >20 scored users, pagination controls appear
- Click page 2, 3 → new rows load, rank numbers update (#21, #22, ...)

### 9. Test 5-minute cooldown
- Click "Recompute Scores" again immediately
- Button shows: "Cooldown Xs" (countdown from 300)
- Disabled (greyed out)

### 10. Verify cache status banner
- After compute, amber banner disappears
- Blue info banner: "Cache last updated X min ago — All scores served from CreditScoreCache"

### 11. Click "View" link on any candidate row
- Navigates to `/users/[id]` (user detail page)
- Click back to return

### 12. Verify "How it works" card at bottom
- Shows 5-factor model breakdown
- Shows scale strategy: "5 bulk groupBy queries", "cached in CreditScoreCache", "daily cron"

## Performance at Scale

| Metric | Value |
|--------|-------|
| Page load (cache hit) | ~50ms |
| Recompute (1M users) | ~30-60s |
| Queries at 1M users | 5 (was 4,000,001 in old N+1 approach) |
| Cache freshness | Daily cron recommended |

## 5-Factor Scoring Model

| Factor | Points | What it measures |
|--------|--------|------------------|
| Transaction volume | 200 | Avg monthly sales (6 months) |
| Collection rate | 150 | Paid / total sales |
| Product diversity | 100 | Distinct products |
| Party base | 75 | Distinct customers/suppliers |
| Transaction consistency | 175 | Total transaction count |

**Score bands:**
- 750-900 = Excellent (₹200/lead)
- 650-749 = Good (₹150/lead)
- 550-649 = Fair (₹100/lead)
- 300-549 = Poor (₹0/lead — do not recommend)
