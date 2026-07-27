# Out-of-band index creation

## Why these are not in a Prisma migration

Prisma wraps every migration file in a single transaction. `CREATE INDEX
CONCURRENTLY` **cannot run inside a transaction block** — Postgres rejects it
outright. A migration containing it fails mid-deploy and leaves the schema in a
`P3009` failed state.

This project has already been bitten by exactly that: the V12 outage.

Without `CONCURRENTLY`, `CREATE INDEX` takes an `ACCESS EXCLUSIVE` lock on the
table for the whole build. On a billion-row `Transaction` table that is **the
shopkeepers' app being down** — not slow, down — for as long as the build takes.
Every write blocks.

So these run **by hand, outside the deploy**, against a direct (non-pooled)
connection.

## How to run

Use `DIRECT_URL`, not the pooled `-pooler` host. PgBouncer in transaction mode
cannot hold the session-level state `CONCURRENTLY` needs.

```bash
psql "$DIRECT_URL" -f prisma/indexes/001-admin-indexes.sql
```

Run them **one at a time** and watch each finish. They are all
`IF NOT EXISTS`, so re-running is safe.

## If one fails

A failed `CREATE INDEX CONCURRENTLY` leaves an **invalid** index behind. It
still costs write throughput while being useless for reads. Find and drop it
before retrying:

```sql
SELECT c.relname
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE i.indisvalid = false;

DROP INDEX CONCURRENTLY <name>;
```

## Verifying an index is actually used

Creating an index proves nothing. Confirm the planner picks it:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "User"
WHERE "deletedAt" IS NULL
ORDER BY "createdAt" DESC, id DESC
LIMIT 26;
```

Look for `Index Scan using ...`. If you see `Seq Scan`, the index is not being
used and adding it achieved nothing but slower writes.
