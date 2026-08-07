# 02 — The money-drift guard that never ran, and the CI it took down with it

**Date:** 2026-08-07
**Trigger:** CI red on `main` since 2026-08-05
**Severity:** High — the Build step had not executed for two days, and the one
check standing between a paise migration and silent production write failures
was inert from the day it was written.

---

## 1. What was broken

```
FAIL tests/money-columns-are-integers.test.ts
Error: ENOENT: no such file or directory, open
  '/home/runner/work/bahikhata-admin/pro/prisma/migrations/20260712000001_paise_migration/migration.sql'
  ❯ tests/money-columns-are-integers.test.ts:99:20
Test Files  1 failed | 38 passed (39)
```

Two faults, and between them the cross-repo comparison had **never run
anywhere** — not in CI, not on any developer's machine.

**Fault 1 — `describe.skip` still executes its callback.** Vitest runs the body
to discover the tests it will then mark skipped. The `readFileSync` sat directly
in that body, so it ran whether or not the guard said skip, threw, and failed
the whole file. The guard did not guard.

```ts
const run = hasSibling ? describe : describe.skip
run('against the main app checkout', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8')   // ← runs even when skipped
```

**Fault 2 — the sibling path was wrong anyway.** It looked for `../pro`. The
repository is `bahikhata-pro`, so even a developer with both checked out side by
side got `hasSibling === false`.

---

## 2. Why it mattered more than a red badge

`ci.yml`'s own header says *"Every step here is BLOCKING. If this is red, the app
is broken."* Test runs **before** Build, so:

- The admin **Build step had not executed since 2026-08-05**. A build break
  would have been invisible.
- Any genuine new failure arrived on an already-red baseline and read as "still
  the known one".
- Most of all: this test is the **only** detector of money-schema drift between
  the two apps. This app has no `prisma/migrations` directory — its schema is a
  hand-maintained copy of a database the main app owns.

That drift is not hypothetical. It has happened: seven columns
(`RevenueSchedule.amount`, `DailyStats.mrr/newMrr/churnedMrr/arr/totalGmv/aiCostInr`)
said `Float` while the live columns were `integer`. Prisma serialised a float
into an int4 column and **every write failed** with `22P03`, killing revenue
recognition and the daily-stats job — while reads looked perfectly fine. This
test was written to stop that recurring, and it had never once run.

---

## 3. The fix, in two halves

Repairing only the crash would have made the suite green by **skipping
forever** — a check that skips is a check that passes for the wrong reason, and
the main repo's CI already carries a comment about exactly that failure mode
(`next lint` exiting 1 behind `continue-on-error` for months). So both halves
were needed.

**Half one — make skipping work, and find the sibling.**
- The migration is read lazily, inside `it()`, so `.skip` can actually skip.
- The path resolves against candidates: `MAIN_APP_PATH`, `../bahikhata-pro`,
  `../pro`.
- `MAIN_APP_PATH`, when set, is the **only** candidate. An explicit setting
  should override rather than join a queue — and without that the skip path is
  untestable on a machine that happens to have the sibling, because both the
  "present" and "absent" runs find it and pass. That looks like proof and is not.

**Half two — make CI actually supply the sibling.**
- A second `actions/checkout` clones `rahulkothari677/bahikhata-pro` (public, no
  token) into `main-app`, sparse to `prisma/migrations`.
- The Test step sets `MAIN_APP_PATH` and `REQUIRE_MAIN_APP=1`.
- With `REQUIRE_MAIN_APP` set, a missing checkout **fails loudly** instead of
  skipping — otherwise the day someone changes the path, this quietly stops
  comparing anything and nobody learns until production writes fail again.

---

## 4. Verified — all four states, deliberately

| State | Expected | Result |
|---|---|---|
| No sibling, no CI flag | skip cleanly | 2 skipped, suite green (previously: crash) |
| Sibling present | actually compare | 2 ran and passed |
| CI flag set, sibling missing | fail loudly | fails, listing every path it looked in |
| Sibling present, schema drifted | catch the drift | **caught** |

The last row is the one that matters. `Payment.amount` was changed `Int` →
`Float` on purpose, and the test failed with:

```
"Payment.amount is Float here but INTEGER in the database"
```

A guard that survives the fault it was written for is not a guard. This one was
broken on purpose to confirm it does not.

Full suite afterwards: **615 tests pass across 39 files**, type-check clean,
lint 0 errors, and **the Build step succeeds** — the first time it has been
exercised since 5 August.

---

## 5. What to take from it

The failure mode here was not "someone wrote a bad test". It was **a safety net
that reported success while catching nothing**, which is strictly worse than no
net: it occupies the place where a real check would go.

Both halves of this fix exist to prevent the same thing recurring in a quieter
form. Making the crash stop was easy. Making sure the check still *runs* — and
fails when it cannot — was the actual work.
