# Scale plan — read replica and partitioning

Master report §D4 and §D5. Written 2026-07-28.

**Neither of these is work to do today.** Both cost money and add moving parts,
and doing them early is how you end up maintaining machinery you do not need.
What matters now is that the code stays *shaped* so they drop in later without
a rewrite — and that you know the number at which to act, instead of finding
out because a shopkeeper's save timed out.

---

## The one-line summary

| | Do it when | Costs | If you skip it |
|---|---|---|---|
| **Read replica (§D5)** | You hire the first non-founder who uses the admin panel daily | Neon Pro (~$19/mo + compute) | An admin report can slow down or fail a real shopkeeper's save |
| **Partitioning (§D4)** | `Transaction` or `AdminAction` passes ~100M rows | Engineering time only | Queries and retention deletes get slower, gradually, then suddenly |

---

# D5. Read replica — the more important one

## The actual problem

**The admin panel and the shopkeepers' app share one database.**

When you open a dashboard that scans a big table, that query competes for the
same connections and CPU that a shopkeeper's "Save bill" needs. Yours is a
report and can wait. Theirs is a customer standing at a counter.

This is not theoretical: this project has already seen 2–5 second GETs from
connection-pool contention, which is what made Prisma abort a transaction
mid-edit and show "Failed to update transaction" on every attempt.

Right now you are the only admin user, so the load is one person clicking
occasionally. **The day a second person is in the panel all day, this becomes
real.**

## The trigger

Provision the replica when **any** of these is true:

- someone other than you uses the admin panel daily
- a dashboard or export regularly takes more than ~3 seconds
- shopkeeper-facing p95 latency rises while an admin report is running

## What to do

1. Neon console → your project → **Branches / Read replicas** → add a read
   replica **in the same region** (`ap-southeast-1`). Same-region replicas share
   Neon's storage layer, so there is no replication lag for committed writes —
   a read replica will not show you stale data.
2. Add `READ_DATABASE_URL` to the **admin app's** Vercel environment, pointing at
   the replica's pooled (`-pooler`) host.
3. Split the clients in `src/lib/db.ts`:

   | Client | Points at | Used by |
   |---|---|---|
   | `dbWrite` | primary | admin mutations only |
   | `dbRead` | replica | every dashboard, list, export, analytic |
   | `dbReadonly` | replica + `admin_readonly` role | the SQL console only |

4. Set `statement_timeout` on the replica connection: **10s** for interactive
   requests, **120s** for the job runner. A runaway admin query then dies
   instead of holding a connection.
5. Add a lint rule banning `dbWrite` inside any `GET` handler — otherwise the
   split silently erodes the first time someone is in a hurry.

## What already makes this a drop-in

- exports page with keyset pagination and stream rather than loading everything
- the heaviest read path (subject-access export) already batches at 1,000 rows
- `withAdmin` is a single choke point, so the client swap happens in one file

## What already exists (checked 2026-07-28, not recalled)

`src/lib/db.ts` already exports **two** clients, so the split is half done:

- `db` — the money-extended client, used by everything
- `dbReadonly` — a separate client on `READONLY_DATABASE_URL`, used only by the
  SQL console, and it fails closed in production when that variable is unset

The remaining gap is that **both point at the primary**. `admin_readonly`
restricts what the SQL console can *do*; it does not stop it competing for the
same CPU and connections as a shopkeeper's save. Step 3 is therefore smaller
than it looks: point `dbReadonly` at the replica, and add `dbRead` for
dashboards and exports.

§D7 (pin the admin app to the database's region) is **already done** —
`vercel.json` sets `"regions": ["sin1"]`. If the database ever moves to India,
both apps move together, never separately.

---

# D4. Partitioning — later, and only for two tables

## The trigger

**~100 million rows** in `Transaction` or `AdminAction`. Check with:

```sql
SELECT relname, n_live_tup
FROM pg_stat_user_tables
WHERE relname IN ('Transaction', 'AdminAction')
ORDER BY n_live_tup DESC;
```

`n_live_tup` is an estimate, which is fine — you are looking for an order of
magnitude, not a precise count. Worth glancing at once a quarter.

To put 100M in context: 100,000 shops writing 20 bills a day reach it in about
**four months**. A thousand shops take a decade. This is a "you succeeded"
problem.

## What changes

Convert to **monthly range partitions** on the timestamp column:

- A query for "last 30 days" touches one or two partitions instead of the whole
  table.
- **Retention (§B3) becomes `DETACH PARTITION`** — instant — instead of a
  `DELETE` that runs for six hours, bloats the table, and needs a `VACUUM FULL`
  afterwards. This is the bigger win of the two, and the reason to do it before
  your first retention deadline rather than after.

## The rule that keeps it possible

**Every query must filter with a bounded range on the partition column:**

```sql
WHERE "createdAt" >= $from AND "createdAt" < $to     -- ✅ prunes
WHERE date_trunc('month', "createdAt") = $month      -- ❌ scans everything
WHERE "createdAt"::date = $day                       -- ❌ scans everything
```

A function or a cast on the partition column defeats pruning entirely, and the
query silently reverts to reading every partition. It will not error. It will
just be slow, and only in production.

**This is why the rule matters now, years before the partitioning happens:** a
query written today with `date_trunc` will still be there, and will quietly not
benefit. Grep for `date_trunc` and `::date` in admin queries occasionally.

## Migration sketch (do not run this yet)

Partitioning an existing table is not `ALTER TABLE`. The shape is:

1. Create `Transaction_partitioned`, `PARTITION BY RANGE ("date")`.
2. Create monthly partitions covering all existing data plus a few months ahead.
3. Backfill in batches, oldest first, keyed on `id` — never one big `INSERT
   ... SELECT`, which would hold a transaction open for hours.
4. Dual-write briefly, verify counts match per month, then swap names inside a
   short transaction.
5. Keep the old table for a week before dropping.

Budget a day, do it on a quiet weekend, and rehearse it on a Neon branch first —
that is what branches are for.

## Also from §D6, worth checking now

- Use the Neon **`-pooler`** host with `pgbouncer=true` everywhere serverless.
- `connection_limit=10` per instance. **Never 1** — that serialises every query
  in the function. A startup checker in the main app once *demanded* that
  harmful value.
- Long-running jobs use a separate **direct, non-pooled** connection.
  Transaction-mode pooling breaks prepared statements and advisory locks.

---

## Review

Re-read this when you hire your first employee, and again at your first
retention deadline. If neither has happened, there is nothing to do.
