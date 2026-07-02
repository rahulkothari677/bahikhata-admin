# Phase 2 (18/22) — Segment-to-Campaign

**Page URL:** `/campaigns` (enhanced) + `/segments/[segmentId]` (new button)
**Sidebar location:** Engagement group → Campaigns / Growth group → User Segments
**Commit:** `pending`

## What This Feature Does

Connects user segments with campaigns for targeted outreach:
- **Segment dropdown** in Campaign Editor (replaces manual text input)
- Shows segment name + user count in dropdown options
- Blue info banner showing how many users will receive the campaign
- **"Create Campaign" button** on Segment detail page — navigates to campaigns with segment pre-selected
- URL param support: `/campaigns?segment=power_users` auto-opens editor with segment selected
- No new schema — uses existing `UserSegmentCache` + `Campaign.targetSegmentId`

## What Changed

| Old | New |
|-----|-----|
| Manual text input for segment ID | Dropdown with segment name + user count |
| No preview of recipient count | Blue banner: "X users will receive campaign" |
| No link from Segments page | "Create Campaign" button on segment detail |
| No URL param support | `?segment=power_users` auto-opens editor |

## How to Test

### 1. Via Segments page (recommended flow)
- Login → Growth group → **User Segments**
- Click any segment (e.g. "Power Users")
- On the segment detail page, click **"Create Campaign"** button (top-right, megaphone icon)
- You're redirected to `/campaigns?segment=power_users`
- Campaign Editor opens automatically with the segment pre-selected
- Blue banner shows: "✓ Targeting segment: ⚡ Power Users (X users will receive campaign notifications)"

### 2. Via Campaigns page directly
- Login → Engagement group → **Campaigns**
- Click **"+ New Campaign"**
- In the **Target Audience** field, you now see a dropdown:
  - "— Manual user IDs (enter below) —" (default)
  - "⚡ Power Users (X users)"
  - "🐋 Whales (X users)"
  - "⚠️ At Risk (X users)"
  - etc. (all 10 segments with counts)
- Select a segment → blue info banner appears showing recipient count
- Select "Manual user IDs" → textarea appears for entering user IDs

### 3. Create a campaign targeting a segment
- Select "⚡ Power Users" from dropdown
- Fill in: Name, Steps (select templates, set delays)
- Click "Create Campaign"
- Green toast: "Campaign created"
- Campaign appears in list with target = segment

### 4. Run the campaign
- Click the campaign row → expand
- Click "Start Campaign" → status = running
- Click "Run Now" on step 1 → sends to all users in the segment

### 5. Verify segment user count
- Go to Segments page → click "Power Users"
- Note the user count (e.g. 150 users)
- Go to Campaigns → New Campaign → select "Power Users" from dropdown
- Blue banner should show same count (150 users)

## Available Segments (10)

| Segment ID | Name | Description |
|-----------|------|-------------|
| power_users | ⚡ Power Users | Highly active users |
| whales | 🐋 Whales | High transaction volume |
| new_users | 🆕 New Users | Recently signed up |
| at_risk | ⚠️ At Risk | Showing churn signals |
| churned | 💀 Churned | Already churned |
| ai_power | 🤖 AI Power Users | Heavy AI feature users |
| free_active | 🆓 Free Tier Active | Active on free plan |
| paying | 👑 Paying Users | Active paid subscribers |
| abandoned | 🚫 Trial Abandoned | Started trial but didn't convert |
| rising_stars | 🌟 Rising Stars | Growing engagement |

## Performance at Scale

| Metric | Value |
|--------|-------|
| Segments API | ~50ms (1 groupBy query on UserSegmentCache) |
| Campaign editor load | Same as before (segments cached 5 min) |
| Segment user count | Pre-computed in UserSegmentCache (instant) |
