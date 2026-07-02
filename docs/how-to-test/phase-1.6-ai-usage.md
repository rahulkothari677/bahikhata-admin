# Phase 1.6 (1/5) — AI Usage & Cost

**Page URL:** `/ai-usage`
**Sidebar location:** Intelligence group → AI Usage & Cost (coins icon)
**Commit:** `5f82d66`

## What This Feature Does

Real-time AI cost tracking across all users:
- 4 KPI cards: Today, This Week, This Month, All Time (cost in ₹)
- Feature breakdown: scan-bill vs voice-parse (with colored progress bars)
- Provider breakdown: Gemini/Groq/OpenAI/VLM (with colored badges)
- Top Users tab: paginated list of highest AI spenders (server-side search)
- Recent Calls tab: paginated list of recent AI calls (search + feature/provider filters)
- Uses 10 parallel aggregate queries (was 3 unbounded findMany before)

## How to Test

### 1. Open the page
- Login to admin panel
- Click **AI Usage & Cost** in the sidebar (Intelligence group, coins icon)

### 2. Overview tab (default)
- 4 KPI cards at top:
  - **Today's Cost** (₹X, with calls + tokens sublabel)
  - **This Week** (₹X, with calls sublabel)
  - **This Month** (₹X, with calls + failed count)
  - **All Time** (₹X, with total calls)
- Two side-by-side cards:
  - **By Feature (This Month)** — scan-bill + voice-parse with colored progress bars
  - **By Provider (This Month)** — Gemini/Groq/OpenAI/VLM with colored badges
- **Today's Performance** card: Total Calls, Success Rate %, Failed, Avg Duration ms
- **"How data is computed"** transparency card at bottom

### 3. Click "Top Users" tab
- Search bar at top
- Paginated table: Rank, User (name+email+avatar), Plan badge, Calls, Tokens, Cost
- Sorted by cost descending (highest spender = #1)
- Try typing in search → filters by name/email (server-side)
- Click page 2, 3 if >20 users
- Click any user row → navigates to `/users/[id]`

### 4. Click "Recent Calls" tab
- Search bar + feature filter pills + provider filter pills
- Feature filters: All Features / scan-bill / voice-parse
- Provider filters: all / gemini / groq / openai / vlm
- Paginated list (20 per page)
- Each row: green/red dot (success/fail) + feature + provider badge + model + user email + time ago
- Right side: token count + cost (₹) + duration (ms)
- Failed calls highlighted in red with error message

### 5. Test filters
- Click "scan-bill" + "gemini" → only Gemini scan-bill calls show
- Search by user email → only that user's calls show
- Click page 2, 3 → pagination updates

### 6. Verify no 30s polling
- Open DevTools → Network tab → filter by "ai-usage"
- Should see ONE request per tab switch, then NO auto-refresh every 30s

### 7. Verify cache
- Switch between tabs quickly → data loads instantly from React Query cache
- Wait 60s → switching tabs triggers fresh fetch

### 8. If no AI calls exist yet
- All KPIs show ₹0 / 0 calls
- Top Users: "No AI calls this month yet"
- Recent Calls: "No AI calls have been made yet"
- No crashes, no white screen

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (10 parallel aggregate queries) |
| Top Users tab | ~100ms (groupBy with skip/take + small findMany) |
| Recent Calls tab | ~100ms (findMany with take=20) |
| Polling | None (was 30s before — removed) |
| Cache | 60s staleTime |
