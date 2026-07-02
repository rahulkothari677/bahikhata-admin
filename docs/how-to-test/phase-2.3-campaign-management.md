# Phase 2 (3/22) — Campaign Management

**Page URL:** `/campaigns`
**Sidebar location:** Engagement group → Campaigns (megaphone icon)
**Commit:** `6ef0e8b`

## What This Feature Does

Multi-step notification sequences (drip campaigns):
- Each campaign has 1+ steps, each using a notification template
- Step delays in minutes after campaign start (0 = immediate, 4320 = 3 days, 10080 = 7 days)
- Target audience: segment ID (uses UserSegmentCache) OR manual user ID list
- Lifecycle: draft → scheduled → running → paused → completed | cancelled
- Actions: start, pause, resume, cancel, run-step (manual trigger for testing)
- Max 1000 recipients per synchronous step (production: background cron job)

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Engagement** group in sidebar
- Click **Campaigns** (megaphone icon, 3rd item)

### 2. Overview tab (default)
- 4 KPI cards: Active Campaigns (0), Drafts (0), Completed (0), Notifications Sent (0)
- **"How campaigns work"** transparency card

### 3. Create your first campaign
- Click **"+ New Campaign"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Name**: `Test Onboarding Campaign`
  - **Description**: `Welcome new users with a 3-step drip`
  - **Target Audience**: Leave segment ID empty, enter 1-2 user IDs in textarea (get IDs from `/users` page)
  - **Start At**: Leave empty (saves as draft)
  - **Step 1**: Select an active SMS template, Delay = `0` (Immediate)
  - Click **"+ Add Step"**
  - **Step 2**: Select an active email template, Delay = `4320` (3 days)
- Click **"Create Campaign"**
- Green toast: "Campaign created"
- Page switches to "All Campaigns" tab

### 4. Verify in list
- See your "Test Onboarding Campaign" with:
  - Status badge: `draft` (grey)
  - "2 step(s)" label
  - Recipients: 0, Sent: 0 (not started yet)
- Click the row → expands to show detail

### 5. View expanded detail
- Action button: **Start Campaign** (green)
- Steps timeline showing:
  - Step 1: Template name, "Immediate" delay, `pending` badge (grey), **"Run Now"** button
  - Step 2: Template name, "3d" delay, `pending` badge, **"Run Now"** button

### 6. Test "Run Now" on step 1
- Click **"Run Now"** on step 1
- Loading, then green toast: "Step 1 executed — Sent: 0 · Failed: 0 · Skipped: 1"
- (Skipped because no SMS provider configured — dry-run mode)
- Step 1 status changes to `sent` (green badge)
- Step 1 shows "Sent: 0, Skipped: 1" stats

### 7. Start the campaign
- Click **"Start Campaign"** button
- Green toast: "Campaign started"
- Campaign status changes from `draft` to `running` (amber badge)
- Action buttons change to: **Pause** + **Cancel**

### 8. Test pause/resume
- Click **Pause** → status changes to `paused`, buttons change to **Resume** + **Cancel**
- Click **Resume** → status changes back to `running`

### 9. Test cancel
- Click **Cancel** → confirmation dialog
- Confirm → status changes to `cancelled` (red badge), pending steps marked as `skipped`
- Action buttons disappear (no actions allowed on cancelled)

### 10. Test filters
- Click "draft" pill → shows only draft campaigns
- Click "running" pill → shows only running campaigns
- Click "all" → shows all

### 11. Test search
- Type "onboarding" in search bar → filters to your test campaign

### 12. Verify audit trail
- Go to **Audit Log** page
- See `campaign_create`, `campaign_step_run`, `campaign_start`, `campaign_pause`, `campaign_resume`, `campaign_cancel` actions

## Campaign Lifecycle

```
draft → scheduled → running → completed
                    ↓ ↑
                  paused
                    ↓
                 cancelled
```

### Status Meanings

| Status | Description |
|--------|-------------|
| draft | Created but not scheduled (no startAt set) |
| scheduled | startAt set to future time |
| running | Currently active, steps executing on schedule |
| paused | Temporarily halted (pending steps wait) |
| completed | All steps finished |
| cancelled | Stopped early (pending steps marked skipped) |

## Step Delay Examples

| Delay (minutes) | Equivalent |
|-----------------|------------|
| 0 | Immediate |
| 60 | 1 hour |
| 1440 | 1 day |
| 4320 | 3 days |
| 10080 | 7 days |
| 20160 | 14 days |

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (7 parallel count queries) |
| List tab | ~100ms (findMany with take=20 + count) |
| Max recipients per step | 1000 (synchronous — production uses background job) |
| Sending strategy | Sequential (avoids rate-limit bans) |

## Production Note

In production, a cron job should:
1. Poll `CampaignStep` where `status='pending'` AND `scheduledAt <= now`
2. For each, fetch recipients (segment or userIds)
3. Send via notification-providers
4. Update step status + counts

Current implementation does this synchronously for immediate feedback (capped at 1000 recipients).
