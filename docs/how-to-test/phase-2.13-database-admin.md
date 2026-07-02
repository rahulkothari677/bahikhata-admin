# Phase 2 (13/22) — Database Admin Tools

**Page URL:** `/database`
**Sidebar location:** System group → Database Admin (database icon)
**Commit:** `pending`

## What This Feature Does

Safe read-only SQL query runner + table stats + CSV export:
- **Query Runner**: Execute SELECT queries with full validation (no INSERT/UPDATE/DELETE)
- **Table Stats**: Row count + disk size for all tables (via PostgreSQL `pg_stat_user_tables`)
- **CSV Export**: Download query results as CSV file
- **Security**: Only SELECT/WITH queries, max 1000 rows, 10s timeout, blocked keywords, all queries audited
- **Example queries**: 5 pre-built queries for common investigations

## Security Guarantees

| Rule | Enforcement |
|------|------------|
| Only SELECT queries | Query must start with `SELECT` or `WITH` |
| No data modification | 15 blocked keywords: INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, etc. |
| No multiple statements | Semicolons blocked (except trailing) |
| Max 1000 rows | `LIMIT 1001` appended, results truncated if > 1000 |
| 10s timeout | `withTimeout(query, 10000)` |
| Full audit trail | Every query logged to `AdminAction` with SQL + row count + duration |

## How to Test

### 1. Open the page
- Login to admin panel
- Find **System** group in sidebar (slate shield icon)
- Click **Database Admin** (database icon, 6th item)

### 2. Overview tab (default)
- 4 KPI cards: Total Tables, Total Rows, Database Size (MB), Largest Table
- **Top 10 Tables by Size** card — ranked list with row count + size badge
- **Read-Only Safety Guarantees** green card with 5 rules

### 3. Click "Query Runner" tab
- SQL textarea (monospace font)
- **"Run Query"** button (blue) + **"Export CSV"** button (green)
- 5 example query buttons (click to fill textarea):
  - Count users by plan
  - Recent 10 users
  - AI cost last 7 days
  - Active subscriptions
  - Table row counts

### 4. Run your first query
- Click "Count users by plan" example button
- Textarea fills with: `SELECT plan, COUNT(*) as count FROM "User" GROUP BY plan ORDER BY count DESC`
- Click **"Run Query"**
- Green toast: "Query executed — X rows in Yms"
- Results table appears below with columns: `plan`, `count`

### 5. Export to CSV
- With a query in the textarea, click **"Export CSV"**
- CSV file downloads to your computer
- File name: `export_YYYY-MM-DD.csv`

### 6. Try a blocked query
- Type: `DELETE FROM "User"`
- Click "Run Query"
- Red toast: "Blocked keyword detected: DELETE"

### 7. Try a non-SELECT query
- Type: `INSERT INTO "User" (id, email) VALUES ('test', 'test@test.com')`
- Click "Run Query"
- Red toast: "Only SELECT queries are allowed"

### 8. Browse a table
- Click "All Tables" tab
- See all tables with row count + size + "Browse →" link
- Click "Browse" on any table
- Switches to Query Runner with `SELECT * FROM "TableName" LIMIT 10` pre-filled
- Click "Run Query" to see the data

### 9. Verify audit trail
- Go to **Audit Log** page (`/audit-log`)
- See `database_query` actions with SQL text + row count + duration
- See `database_export` actions for CSV downloads

## Example Queries

### Count users by plan
```sql
SELECT plan, COUNT(*) as count FROM "User" GROUP BY plan ORDER BY count DESC
```

### Recent 10 users
```sql
SELECT id, email, name, plan, "createdAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 10
```

### AI cost last 7 days
```sql
SELECT DATE("createdAt") as date, SUM("costInr") as cost
FROM "AiUsageLog"
WHERE "createdAt" >= NOW() - INTERVAL '7 days'
GROUP BY DATE("createdAt")
ORDER BY date DESC
```

### Active subscriptions by plan
```sql
SELECT plan, COUNT(*) as count, SUM(amount) as total_revenue
FROM "Subscription"
WHERE status = 'active'
GROUP BY plan
```

### Table row counts
```sql
SELECT relname as table_name, n_live_tup as row_count
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC LIMIT 20
```

## Important Notes

1. **Table names are case-sensitive**: Use double quotes — `"User"`, not `User` or `user`
2. **Column names with capital letters**: Also need double quotes — `"createdAt"`, `"userId"`
3. **Max 1000 rows**: If your query returns more, results are truncated (use LIMIT to control)
4. **10s timeout**: Long-running queries will be killed (add LIMIT to speed up)
5. **All queries logged**: Every query is saved to the audit trail with SQL text + admin who ran it

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~200ms (2 queries: pg_stat_user_tables) |
| Query execution | Variable (depends on query complexity) |
| Max rows returned | 1000 |
| Query timeout | 10 seconds |
| Table stats | ~100ms (pg_stat_user_tables is fast) |

## Integration Points

This feature connects to:
- **Audit Log** (`/audit-log`): All queries logged as `database_query` + `database_export` actions
- **All tables**: Can query any table in the database (User, Transaction, Subscription, etc.)
