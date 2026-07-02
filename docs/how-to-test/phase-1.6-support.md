# Phase 1.6 (4/5) — Support Tickets

**Page URL:** `/support`
**Sidebar location:** Users group → Support Tickets (headphones icon)
**Commit:** `2776db1`

## What This Feature Does

Support ticket management:
- Overview tab: 4 KPI cards (active, urgent, resolved+closed, new-7d) + category distribution
- All Tickets tab: two-column layout (list left, detail right)
- Search by subject, message, or user email (server-side)
- Status filter: All / Open / In Progress / Resolved / Closed
- Priority filter: All / Urgent / High / Medium / Low
- Ticket detail panel: badges, message, user card (links to /users/[id]), response textarea, 5 action buttons

## How to Test

### 1. Open the page
- Login to admin panel
- Click **Support Tickets** in the sidebar (Users group, headphones icon)

### 2. Overview tab (default)
- 4 KPI cards:
  - **Active Tickets** (count + "X open · Y in progress")
  - **Urgent (Active)** (count + "Open or in-progress urgent tickets")
  - **Resolved + Closed** (count + breakdown)
  - **New (Last 7 Days)** (count)
- **Active Tickets by Category** card with progress bars (bug, feature, general, etc.)
- **"How data is computed"** transparency card at bottom

### 3. Click "All Tickets" tab
- Top: search bar + 5 status filter pills + 5 priority filter pills
- Two-column layout:
  - **Left column** (1/3 width): scrollable list of tickets (subject, email, status badge, priority badge, time)
  - **Right column** (2/3 width): ticket detail panel (empty by default — "Select a ticket to view details")
- Click any ticket on left → detail panel shows on right

### 4. Ticket detail panel
- Top: 3 badges (priority, status, category)
- Subject (large bold) + message (muted text)
- User card: avatar + name + email + plan (click name → links to `/users/[id]`)
- If previous response exists: blue card with admin response + resolver info
- Textarea for new response
- 5 action buttons:
  - **Assign to Me** (amber — sets status to in_progress)
  - **Resolve with Response** (emerald — sends response + sets resolved)
  - **Send Response Only** (blue — sends response without changing status)
  - **Mark Urgent** (red — sets priority to urgent)
  - **Close** (muted — sets status to closed)

### 5. Test search
- Type "login" in search bar → filters tickets by subject, message, OR user email/name (server-side)

### 6. Test filters
- Click "Open" status pill → only open tickets show
- Click "Urgent" priority pill → only urgent tickets show
- Combine: search + status + priority → all filters apply together

### 7. Test pagination
- If >20 tickets match filters, pagination controls appear at bottom

### 8. Test ticket actions
- Click any ticket → click "Assign to Me"
- Green toast: "Ticket updated"
- Ticket disappears from "Open" filter (now in "In Progress")
- Switch to "In Progress" filter → ticket appears there

### 9. Test response
- Click any open ticket → type a response in textarea
- Click "Resolve with Response"
- Green toast, ticket moves to Resolved
- Switch to "Resolved" filter → ticket appears with admin response visible

### 10. If no tickets exist yet
- Overview: all KPIs show 0, category distribution shows "No active tickets"
- List tab: "No support tickets yet"
- No crashes, no white screen

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (7 parallel count queries) |
| List tab | ~100ms (findMany with take=20 + count) |
| Search | Server-side (scales to millions of tickets) |
| Polling | None |
| Cache | 30s staleTime (fresher than other pages — support needs real-time) |
