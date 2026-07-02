# Scalability Principles — 13-Point Checklist

Every feature in this admin panel MUST satisfy these 13 principles before shipping.

## The 13 Checks

### 1. Does it fetch unbounded data? → Add pagination
**Problem:** `findMany()` without `take` returns ALL rows. At 1M rows, this crashes the server.
**Solution:** Always use `skip` + `take` (e.g., `take: 20` per page).
```typescript
// BAD
const users = await db.user.findMany()

// GOOD
const users = await db.user.findMany({ skip: (page-1)*20, take: 20 })
```

### 2. Does it do N+1 queries? → Use bulk aggregate
**Problem:** Looping through users and querying each one = 1001 queries for 1000 users.
**Solution:** Use `groupBy()` or `aggregate()` — 1 query for all users.
```typescript
// BAD (N+1)
for (const user of users) {
  const count = await db.transaction.count({ where: { userId: user.id } })
}

// GOOD (bulk)
const counts = await db.transaction.groupBy({ by: ['userId'], _count: true })
```

### 3. Does it compute on every page load? → Pre-compute + cache
**Problem:** Computing MRR from all subscriptions on every page load = slow.
**Solution:** Pre-compute in `DailyStats` table (background job), read from cache on page load.
```typescript
// BAD (compute on load)
const subscriptions = await db.subscription.findMany()
const mrr = subscriptions.reduce((sum, s) => sum + s.amount, 0)

// GOOD (read from cache)
const stats = await db.dailyStats.findFirst({ orderBy: { date: 'desc' } })
const mrr = stats?.mrr || 0
```

### 4. Does it load all rows in memory? → Cursor pagination
**Problem:** `findMany()` with `take: 100000` loads 100K rows into memory = OOM.
**Solution:** Use cursor-based pagination for large exports.
```typescript
// BAD
const all = await db.user.findMany({ take: 1000000 })

// GOOD (cursor pagination)
const batch = await db.user.findMany({
  take: 1000,
  skip: 1,
  cursor: { id: lastId },
})
```

### 5. Does it poll frequently? → Increase interval or use webhooks
**Problem:** Polling every 5 seconds = 12 requests/minute per user = server overload.
**Solution:** Use 60s staleTime (React Query), or webhooks for real-time updates.
```typescript
// BAD
refetchInterval: 5000  // 5 seconds

// GOOD
staleTime: 60 * 1000  // 60 seconds (no polling)
```

### 6. Does it block the request? → Background job
**Problem:** Sending 1000 emails synchronously = 30 second request timeout.
**Solution:** Move to background job (Vercel Cron, queue system).
```typescript
// BAD (blocks request)
for (const user of users) {
  await sendEmail(user.email)
}

// GOOD (background job)
await db.notificationLog.createMany({ data: queuedEmails })
// Cron job picks up queued emails and sends them
```

### 7. Does it have search + filter + pagination? → Add them
**Problem:** A list page without search forces users to scroll through 1000s of rows.
**Solution:** Server-side search + filter + pagination on every list page.
```typescript
const where: any = {}
if (search) where.name = { contains: search, mode: 'insensitive' }
if (filter !== 'all') where.status = filter
const [rows, total] = await Promise.all([
  db.model.findMany({ where, skip, take: 20 }),
  db.model.count({ where }),
])
```

### 8. Can a human understand this at 1M+ users? (Cognitive load)
**Problem:** One page with 50 KPIs + 10 tables = information overload.
**Solution:** 3-layer architecture: Executive (dashboard) → Managerial (overview) → Operational (paginated detail).
```
Dashboard: 4-6 KPIs only
Section page: Overview tab + List tab
Detail page: Search + filter + pagination
```

### 9. Every query has a 5-10s timeout (never hang)
**Problem:** A slow query hangs the entire serverless function (Vercel times out at 10s).
**Solution:** Wrap every query in `withTimeout()`.
```typescript
const result = await withTimeout(
  db.user.findMany({ ... }),
  5000
).catch(() => [])  // safe default
```

### 10. Every query catches errors and returns safe defaults (never crash)
**Problem:** One failed query crashes the entire page (white screen).
**Solution:** `.catch()` on every query, return safe defaults.
```typescript
const count = await withTimeout(
  db.user.count(),
  5000
).catch(() => 0)  // never crash, return 0
```

### 11. Every page is wrapped in GlobalErrorBoundary (never white screen)
**Problem:** Unhandled React error = white screen of death.
**Solution:** Global error boundary catches errors, shows friendly card.
```tsx
// src/components/admin/global-error-boundary.tsx
<GlobalErrorBoundary>
  <AdminContent />
</GlobalErrorBoundary>
```

### 12. Every KPI can be cross-checked against live database (investor trust)
**Problem:** Cached numbers might be stale or wrong — investors can't trust them.
**Solution:** Data Verification API cross-checks cached vs live `count()` queries.
```typescript
// /api/admin/validate-data
const cachedTotalUsers = stats.totalUsers
const liveTotalUsers = await db.user.count()
const match = Math.abs(cachedTotalUsers - liveTotalUsers) <= cachedTotalUsers * 0.001
```

### 13. Every result is validated (no NaN, Infinity, negative numbers)
**Problem:** Division by zero = NaN. Large sums = Infinity. Bugs = negative counts.
**Solution:** `validateStat()` checks for invalid values.
```typescript
if (typeof value !== 'number' || isNaN(value) || !isFinite(value) || value < 0) {
  return { value: 0, verified: false }
}
```

---

## Checklist Application

Before merging any new feature, verify ALL 13 checks pass:

```
☐ #1  No unbounded data (pagination on all lists)
☐ #2  No N+1 queries (bulk aggregate/groupBy)
☐ #3  No compute on page load (pre-computed cache)
☐ #4  No loading all rows in memory (cursor pagination for exports)
☐ #5  No frequent polling (60s+ staleTime, no 5s refetchInterval)
☐ #6  No blocking requests (background jobs for heavy work)
☐ #7  Search + filter + pagination on every list
☐ #8  Cognitive load: 3-layer architecture, max 4 KPIs per page
☐ #9  5-10s timeout on all queries (withTimeout)
☐ #10 .catch() returns safe defaults on all queries
☐ #11 GlobalErrorBoundary wraps every page
☐ #12 Data verification API for investor trust
☐ #13 Result validation (no NaN/Infinity/negatives)
```

## Performance Targets

| Metric | Target |
|--------|--------|
| Page load (cache hit) | < 100ms |
| Page load (cache miss) | < 500ms |
| API response (aggregate) | < 200ms |
| API response (paginated list) | < 200ms |
| Background job (1M users) | < 60s |

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Correct Approach |
|--------------|-------------|------------------|
| `findMany()` without `take` | Loads all rows → OOM | Always use `take: 20` |
| `reduce()` on `findMany()` results | Computes in JS, not DB | Use `aggregate({_sum})` |
| JS-side `filter()` on full table | Loads everything, filters in JS | Use DB `where` clause |
| `refetchInterval: 5000` | 12 requests/min/user | Use `staleTime: 60000` |
| Per-user queries in a loop | N+1 problem | Use `groupBy()` |
| Server component with DB query | Crashes on DB sleep | Client component + API |
