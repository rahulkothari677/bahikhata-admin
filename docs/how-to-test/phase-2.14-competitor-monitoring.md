# Phase 2 (14/22) — Competitor Monitoring

**Page URL:** `/competitors`
**Sidebar location:** Growth group → Competitors (swords icon)
**Commit:** `pending`

## What This Feature Does

Track competing apps' pricing, features, and market positioning:
- Add competitors with name, website, description, target market
- Track pricing across 3 tiers (Free, Pro, Elite)
- Compare 10 standard features (AI scanner, voice, GST, etc.)
- Document their USP (unique selling proposition) + weaknesses (our opportunities)
- Every field change logged as CompetitorUpdate (timeline of changes)
- Pricing comparison table with Bahikhata Pro at top (benchmark)
- Feature comparison grid (green = has feature, strikethrough = missing)

## 10 Standard Features Tracked

1. AI Bill Scanner
2. Voice Entry
3. GST Filing
4. Credit Scoring
5. Multi-language
6. Offline Mode
7. Inventory
8. WhatsApp Integration
9. Payment Reminders
10. Profit Tracking

## How to Test

### 1. Open the page
- Login → Growth group → **Competitors** (swords icon, 5th item)

### 2. Overview tab (default)
- 4 KPI cards: Active Competitors (0), Updates 30 days (0), Total Tracked (0), Bahikhata Pro (You)
- If competitors exist: **Pricing Comparison** table with Bahikhata Pro at top (green highlight) + all competitors' Free/Pro/Elite prices
- "How competitor monitoring works" transparency card

### 3. Create your first competitor
- Click **"+ New Competitor"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Name**: `Khatabook`
  - **Website**: `https://khatabook.com`
  - **Target Market**: `Small kirana stores`
  - **Description**: `Digital ledger app for Indian merchants`
  - **Free**: `₹0`
  - **Pro**: `₹249/mo`
  - **Elite**: `₹499/mo`
  - **Features**: Check: AI Bill Scanner, Voice Entry, Offline Mode, Inventory, WhatsApp Integration, Payment Reminders
  - **USP**: `Simplified digital bahi khata with WhatsApp integration`
  - **Weaknesses**: `No AI bill scanner, no GST filing, no credit scoring, no profit tracking`
- Click **"Create Competitor"**
- Green toast: "Competitor saved"

### 4. View in List tab
- Switch to "All Competitors" tab
- See your competitor with: name, status badge, target market badge, pricing summary, update count
- Click the row → expands

### 5. Expanded detail
- **Features** grid: 10 features with green (has) or strikethrough (missing)
- **Their USP** blue card: what makes them stand out
- **Our Opportunities** green card: their weaknesses = our opportunities

### 6. Verify pricing comparison
- Go back to Overview tab
- See **Pricing Comparison** table:
  - Row 1: 🏆 Bahikhata Pro (You) — ₹0 / ₹299/mo / ₹599/mo (green highlight)
  - Row 2: Khatabook — ₹0 / ₹249/mo / ₹499/mo

### 7. Edit a competitor
- Click pencil icon → modal opens
- Change Pro price from ₹249 to ₹299
- Click "Update Competitor"
- Green toast: "Competitor saved"
- Go to Overview → pricing table shows updated price
- Update count increments (change tracked)

### 8. Test filters
- Click "active" pill → only active competitors
- Click "inactive" → only inactive

### 9. Delete a competitor
- Click trash icon → confirm → deleted

### 10. Verify audit trail
- Audit Log page → `competitor_create`, `competitor_update`, `competitor_delete` actions

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (4 parallel count + findMany) |
| List tab | ~100ms (findMany with _count) |
| Cache | 60s (overview), 30s (list) |
