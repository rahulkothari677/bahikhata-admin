# Phase 2 (16/22) — Bulk Operations v2

**Page URL:** `/bulk-jobs`
**Sidebar location:** Users group → Bulk Operations (layers icon)
**Commit:** `pending`

## What This Feature Does

Schedule bulk actions for future execution:
- **5 action types**: Change Plan, Send Message, Ban Users, Delete Users, Export Data
- **3 target options**: by plan tier, by segment ID, or specific user IDs
- **Schedule for future**: set execution time (e.g. "Jan 1 9 AM")
- **Execute Now button**: manually trigger due jobs (1-min cooldown)
- **Stats per job**: total targets, processed, success, failed counts
- **Lifecycle**: scheduled → running → completed | failed | cancelled
- All actions logged to AdminAction audit trail

## 5 Action Types

| Action | What it does | Use Case |
|--------|-------------|----------|
| `change_plan` | Bulk upgrade/downgrade user plans | "Upgrade all free users to Pro on launch day" |
| `message` | Bulk send notification (logged) | "Send Diwali wishes to all Pro users" |
| `ban` | Bulk ban (set cancelledAt) | "Ban all users flagged for fraud" |
| `delete` | Bulk soft-delete (cancel + downgrade) | "Delete all inactive users > 1 year" |
| `export` | Count for export (CSV separate) | "Count all elite users for report" |

## How to Test

### 1. Open the page
- Login → Users group → **Bulk Operations** (layers icon, 3rd item)

### 2. Overview tab (default)
- 4 KPI cards: Scheduled, Completed, Failed, Total Users Processed
- **Upcoming Scheduled Jobs** card (next 5 due jobs)
- "How bulk operations work" transparency card

### 3. Create a bulk job
- Click **"+ New Bulk Job"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Name**: `Test Plan Upgrade`
  - **Action**: `Change Plan`
  - **Schedule For**: Pick a time 2 minutes from now
  - **Target**: Select "plan" radio → "Free users"
  - **New Plan**: `Pro`
- Click **"Schedule Job"**
- Green toast: "Bulk job scheduled"
- Page switches to "All Jobs" tab

### 4. View in list
- See your job with:
  - Status badge: `scheduled` (amber)
  - Action badge: `Change Plan`
  - Target badge: `user`
  - "Scheduled: in 2m"
- Cancel button (amber) + Delete button (red)

### 5. Execute due jobs
- Wait for the scheduled time to pass
- Click **"Execute Due Jobs"** (green, top-right)
- Green toast: "Executed 1 jobs — X users processed · Y success · Z failed"
- Job status changes to `completed` (green)
- Stats show: processed/total, success count, failed count

### 6. Test cancel
- Create another job scheduled for 1 hour from now
- Click **"Cancel"** on that job
- Confirm → status changes to `cancelled` (grey)

### 7. Test filters
- Click "scheduled" → only scheduled jobs
- Click "completed" → only completed jobs
- Click "failed" → only failed jobs

### 8. Test delete
- Click trash icon on any scheduled/cancelled/failed job
- Confirm → job deleted

### 9. Test message action
- Create new job:
  - Action: `Send Message`
  - Target: "pro" plan
  - Subject: `Special Offer`
  - Body: `Get 20% off Elite upgrade this week!`
  - Schedule: 1 minute from now
- Execute → notifications logged to NotificationLog (dry-run mode if no provider configured)

### 10. Verify audit trail
- Audit Log page → `bulk_job_create`, `bulk_jobs_execute`, `bulk_job_update` (cancel), `bulk_job_delete` actions

## Job Lifecycle

```
scheduled → running → completed
                   ↘ failed
scheduled → cancelled (admin cancel before execution)
```

| Status | Color | Meaning |
|--------|-------|---------|
| `scheduled` | Amber | Waiting for scheduled time |
| `running` | Blue | Currently executing |
| `completed` | Green | Finished successfully |
| `failed` | Red | Execution error (check errorMessage) |
| `cancelled` | Grey | Admin cancelled before execution |

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~100ms (6 parallel count + aggregate + findMany) |
| List tab | ~100ms (findMany with take=20 + count) |
| Execution | Max 1000 users per synchronous job |
| Cooldown | 1 minute between manual executions |
| Production | Cron job runs every 1 minute to process due jobs |

## Safety Features

- **Max 1000 users** per synchronous execution (production: background queue)
- **Cancel before execution**: scheduled jobs can be cancelled
- **Soft delete only**: ban/delete set `cancelledAt`, don't actually delete data
- **Full audit trail**: all job actions logged to AdminAction
- **Error tracking**: failed jobs store errorMessage for debugging
- **Test with small group first**: use specific user IDs to test before bulk
