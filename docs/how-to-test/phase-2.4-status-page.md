# Phase 2 (4/22) — Status Page

**Admin page URL:** `/incidents` (manage incidents)
**Public page URL:** `/status` (no auth required — investor-facing)
**Sidebar location:** System group → Status Page (activity icon)
**Commit:** `8c5ab72`

## What This Feature Does

Public status page + incident management:
- **Admin page** (`/incidents`): create/update/resolve incidents, add timeline updates
- **Public page** (`/status`): no auth required, shows real-time service health + incident history
- 4 service health checks: API response time, DB ping, AI provider config, payment config
- Incident lifecycle: investigating → identified → monitoring → resolved
- Severity levels: minor, major, critical, maintenance
- Auto-refreshes every 60 seconds on public page
- Cached for 60s (handles traffic spikes)
- Always returns 200 (status page must never crash)

## Two Pages to Test

### Part A: Admin Incident Management (`/incidents`)

#### 1. Open the admin page
- Login to admin panel
- Find **System** group in sidebar (slate shield icon)
- Click **Status Page** (activity icon)

#### 2. Overview tab (default)
- 4 KPI cards: Active (0), Critical (0), Maintenance (0), Resolved (0)
- Blue banner with link to public `/status` page (opens new tab)
- "How incidents work" transparency card

#### 3. Create your first incident
- Click **"+ New Incident"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Title**: `Database connectivity issues`
  - **Description**: `Users may experience slow response times. Investigating.`
  - **Severity**: `major`
  - **Status**: `investigating`
  - **Service**: `database`
- Click **"Create Incident"**
- Green toast: "Incident created"

#### 4. View in list
- Switch to "All Incidents" tab
- See your incident with:
  - Amber severity dot (major)
  - Title + description
  - Badges: `major` (amber) + `investigating` (amber)
  - "Started just now" + "Database" + "1 update(s)"
- Click the row → expands

#### 5. Test expanded detail
- Quick status change buttons: investigating / identified / monitoring / resolved
- Add update form: textarea + optional status dropdown + "Add Update" button
- Timeline showing the initial update (auto-created on incident creation)

#### 6. Add a timeline update
- Type: `Identified the issue — connection pool exhausted. Working on fix.`
- Select status: `identified`
- Click "Add Update"
- Green toast: "Update added"
- Timeline now shows 2 entries (initial + new)
- Incident status badge changes to `identified`

#### 7. Resolve the incident
- Click "resolved" in quick status change buttons
- Green toast: "Status updated"
- Incident status changes to `resolved` (green badge)
- Resolved timestamp set

#### 8. Test filters
- Click "resolved" status pill → shows only resolved incidents
- Click "all" → shows all

---

### Part B: Public Status Page (`/status`)

#### 9. Open the public status page
- In admin Overview tab, click the `/status` link in blue banner (opens new tab)
- OR go directly to `https://admin.bahikhata.pro/status`
- **NO LOGIN REQUIRED** — page loads directly

#### 10. Verify the public page layout
- White header: "BahiKhata Pro" + "System Status" + Refresh button
- Overall status banner (large, colored):
  - Green: "All Systems Operational" (if no active incidents)
  - Red: "Major Service Outage" (if critical active incident)
  - Amber: "Degraded Performance" (if minor active incident)
- Service status grid: 4 services:
  - API & Web App (globe icon)
  - Database (database icon)
  - AI Providers (CPU icon)
  - Payment Gateway (credit card icon)
  - Each with status label (Operational/Degraded/Down) + response time + colored dot
- If active incidents: "Active Incidents" section shows them with title, description, latest update, badges
- Incident History section: shows your resolved incident
- Footer: "Last updated Xs ago · Auto-refreshes every 60 seconds"

#### 11. Test auto-refresh
- Wait 60 seconds — page auto-refreshes (check footer timestamp updates)
- Or click "Refresh" button for manual refresh

#### 12. Test with an active incident
- Go back to admin `/incidents` page
- Create a new incident with severity `critical`, status `investigating`
- Go to public `/status` page (refresh)
- Overall status changes to "Major Service Outage" (red)
- Active incident appears in "Active Incidents" section
- Add an update in admin → refresh public page → latest update appears

#### 13. Share with investors
- The `/status` URL is publicly accessible
- Share with investors, users, or monitoring tools
- Auto-refreshes every 60 seconds
- Shows real-time service health + incident history
- Strong trust signal for due diligence

## Service Health Checks

| Service | Check Method | Response Time |
|---------|-------------|---------------|
| API & Web App | Always operational if endpoint responds | Measured (ms) |
| Database | `SELECT 1` via `checkDbHealth()` | Measured (ms) |
| AI Providers | Check if `GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` set | N/A |
| Payment Gateway | Check if `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` set | N/A |

## Overall Status Computation

Priority (highest first):
1. **maintenance** — if any active incident has severity=maintenance
2. **major_outage** — if any active incident has severity=critical OR any service is down
3. **partial_outage** — if any active incident has severity=major
4. **degraded** — if any service is degraded OR any active incident has severity=minor
5. **operational** — everything is fine

## Incident Lifecycle

```
investigating → identified → monitoring → resolved
```

### Severity Levels

| Severity | Color | Use Case |
|----------|-------|----------|
| minor | Slate | Small impact, most users unaffected |
| major | Amber | Significant impact, some users affected |
| critical | Red | Major outage, all users affected |
| maintenance | Blue | Scheduled maintenance (planned) |
