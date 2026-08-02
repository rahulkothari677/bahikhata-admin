# BahiKhata Pro + Admin — Independent Audit, Pass 1

**Date:** 2026-08-02
**Scope:** `bahikhata-pro` (~115k LOC) and `bahikhata-admin` (~46k LOC), default branches as cloned today.
**Method:** static analysis of money/ledger/GST/auth paths + full build verification.

---

## 0. Verification baseline (what I actually ran)

| Check | bahikhata-pro | bahikhata-admin |
|---|---|---|
| `prisma generate` | pass | pass |
| `tsc --noEmit` | **clean, 0 errors** | **clean, 0 errors** |
| Unit tests | **2400 passed / 108 suites** | **317 passed / 24 suites** |

This is a genuinely strong baseline. Everything below is therefore a defect that your
test suite does **not** currently catch — which is exactly where the risk lives.

> One caveat on the test run: 11 suites **fail to load** unless `DATABASE_URL` is set,
> because `src/lib/db.ts` constructs `PrismaClient` at module import time. With a dummy
> URL all 108 suites run and pass. See **M7**.

---

## 1. Critical — fix before launch

### C1. Historical `Payment` rows corrupted by the M11 double-conversion have no deterministic repair

**Where:** `src/lib/prisma-money-extension.ts:655-686`, repair tool at `src/app/api/debug/repair-payment-amount/route.ts`

You found and fixed the root cause correctly: `generateModelHandlers()` returned its
handlers **unkeyed**, so all ten `...generateModelHandlers(...)` spreads collided on the
same keys (`create`, `findMany`, …). The last spread won and became a *top-level catch-all*
permanently bound to `modelName='RevenueSchedule'`, running for **every** model in addition
to that model's own handler. Any model whose money columns overlap `RevenueSchedule`'s
(`['amount']`) got converted twice on write:

```
₹100 → Payment handler → 10,000 paise → stray catch-all → 1,000,000 paise (stored)
```

Reads divided twice too, so the UI looked correct while the column was 100× too large.

**The unresolved part:** now that the extension is fixed, reads convert **once**. Every row
written during the bug window therefore reads back **100× too large**. The fix *unmasked*
the corruption rather than resolving it.

Affected columns (all have an `amount` column): `Payment.amount`, `Subscription.amount`,
`BankTransaction.amount`, `BankTransaction.balance`.

The repair endpoint cannot fix this safely. Its own heuristic is
`amount > 10000 paise AND amount % 100 === 0` — which matches essentially every legitimate
₹200 / ₹500 / ₹1,000 cash payment in a kirana shop. The code says so itself, and correctly
refuses to auto-repair. But that leaves you with a manual, eyeball-driven process.

**Recommended action:**
- If **no production users yet** — simplest and safest: wipe the affected tables and start clean.
- If there **is** production data: do not use the divisibility heuristic. Use `createdAt`
  against the known bug window (the commit that keyed `generateModelHandlers`) as the
  discriminator, and write a one-shot migration. Cross-check each candidate against the
  `AuditLog` / `FieldChangeLog` entry for the same payment, which recorded the rupee value.
- Add a CI test that asserts `MONEY_COLUMNS` keys are disjoint from any catch-all, and that
  `generateModelHandlers` output is always keyed by `prismaModel`. This class of bug must
  not be able to return silently.

---

### C2. `party-balance.ts` still runs the M11 emergency workaround — now the wrong choice, and it is unbounded

**Where:** `src/lib/party-balance.ts:170-181` (`computePartyBalance`) and `:374-385` (`getReceivablePayable`)

During the incident, raw SQL "looked wrong" so both functions were switched to sum payments
in **JavaScript** via `db.payment.findMany`. The root cause is now fixed, so the raw-SQL
aggregate is correct and this workaround is pure cost:

```ts
// getReceivablePayable — runs on every dashboard and party-list load
const allPaymentRows = await db.payment.findMany({
  where: { userId, deletedAt: null },
  select: { partyId: true, type: true, amount: true },
})
```

**No `take`, no pagination, no date bound.** This loads *every payment the user has ever
made* into memory on your hottest endpoint. A shop with 50,000 payments loads 50,000 rows
per dashboard hit. This is a latency and memory cliff that arrives precisely as you succeed.

Secondary problem: the divergence `console.error` at `:188` and `:407` will now fire for
every legacy corrupted row from C1, flooding Sentry with an alert that no longer indicates
a live bug.

**Fix:** restore the raw-SQL aggregate (the SQL in the query is correct — it reads paise and
converts via `fromPaise`), keep the existing parity test `v26-party-balance-parity.test.ts`
as the guard, and delete the JS fallback plus the divergence logging.

---

### C3. GST-inclusive (MRP) pricing does not add back up to the MRP

**Where:** `src/lib/line-items.ts`, back-calculation block

For an inclusive line the taxable unit price is back-calculated **and rounded to 2 dp**,
then GST is recomputed *from the rounded value*:

```ts
const unitPriceRupees = includesGst && gstRate > 0
  ? roundMoney((enteredPriceRupees * 100) / (100 + gstRate))
  : enteredPriceRupees
```

Worked example — ₹100 MRP at 18%:

| Step | Value |
|---|---|
| True taxable | 84.745762… |
| `roundMoney` → stored | 84.75 → 8475 paise |
| GST = round(8475 × 0.18) | 1526 paise |
| **Line total** | 8475 + 1526 = **10001 paise = ₹100.01** |

The bill does not equal the MRP printed on the product. Every inclusive-priced line drifts
by a paisa or two, and the error accumulates across lines. `roundOffEnabled` masks it when
switched on, but it is off by default, so the shopkeeper sees ₹100.01 for a ₹100 MRP item —
the exact kind of thing that destroys trust in a ledger app on day one.

**Fix:** for inclusive lines, compute on the **line total in paise** and derive GST by
subtraction so the identity holds exactly:

```
grossPaise  = round(qty × enteredPricePaise)      // the MRP the customer pays
taxablePaise = round(grossPaise × 100 / (100 + rate))
gstPaise     = grossPaise − taxablePaise           // exact by construction
```

This guarantees `taxable + gst === gross` with no residual, per line, per slab.

---

### C4. Impersonation sessions live 30 days, not the intended 1 hour

**Where:** `src/app/api/impersonate/route.ts`

```ts
const jwtToken = await encode({ token: {...}, secret: process.env.NEXTAUTH_SECRET! })
// ...
response.cookies.set({ ..., maxAge: 60 * 60 })  // 1 hour
```

`encode()` is called **without `maxAge`**, so NextAuth applies its own default of 30 days to
the signed JWT. The 1-hour limit is set only on the *cookie*, which is a client-side hint —
it does not shorten the token's server-side validity. Anyone who obtains that token value
(browser storage on a shared machine, a proxy or CDN log, a support screen-share) holds a
valid shopkeeper session for a month.

The `tokenVersion` revocation check does not help: the impersonation token carries the
*target user's* current `tokenVersion`, which nothing bumps when impersonation ends.

**Fix:**
```ts
const jwtToken = await encode({ token: {...}, secret: ..., maxAge: 60 * 60 })
```
and bump the target user's `tokenVersion` when the admin exits impersonation, so the session
dies immediately rather than at expiry.

---

### C5. Invoice `paidAmount` and standalone `Payment` rows double-count, with only a soft warning

**Where:** `src/lib/party-balance.ts:205-213` (the balance identity), warnings at
`src/app/api/transactions/[id]/route.ts` (~line 690) and `src/app/api/payments/route.ts:260-278`

The balance subtracts **both** mechanisms with no allocation between them:

```
balance = openingBalance
        + Σ(sale.totalAmount − sale.paidAmount)
        − Σ(payment.amount WHERE type='received')
        …
```

A shopkeeper who marks a ₹1,000 invoice as paid **and** records a ₹1,000 "Settle Payment"
drives the party balance to **−₹1,000**. Nothing prevents it.

The guards are both soft and both have gaps:
- The transaction-edit warning fires whenever the party has *any* payment — it will be noise
  on most edits, and users learn to dismiss it.
- The payment-side check only fires when the payment **exceeds outstanding**
  (`exceedsOutstanding`). In the exact double-count case, if the party has other unpaid
  invoices, the payment does *not* exceed outstanding — so **no warning is shown at all.**

This is, in my judgement, the most likely source of "my khata is wrong" support tickets
after launch, and it is a design-level issue rather than a coding slip.

**Options, in increasing order of correctness:**
1. Make invoice `paidAmount > 0` auto-create a linked `Payment` row, so there is exactly one
   mechanism and one place money is recorded.
2. Add real allocation (`PaymentAllocation` join: payment → invoice, with an unallocated
   remainder), which is what a ledger of this ambition eventually needs for aging and
   statements to be defensible.
3. Minimum viable: make the invoice-edit path refuse to increase `paidAmount` when
   unallocated payments exist for that party, and explain why.

---

## 2. High

### H1. Rate limit is attached to the wrong handler in `payments/route.ts`

**Where:** `src/app/api/payments/route.ts:26-28`

The limiter sits inside **GET**, with a comment that says it is limiting creation:

```ts
export async function GET(req: NextRequest) {
  ...
  // 🔒 V18: Rate limit payment creation (20/min per user)
  const rl = await rateLimit(`payments:${userId}`, { limit: 20, windowSec: 60 })
```

**POST has no rate limit at all.** The effect is exactly inverted: a user browsing several
party profiles gets 429s on *reading* their own payment history, while unlimited payment
creation is permitted. Move it to POST (and if you want a read limit, give it a separate,
much higher budget and a distinct key).

### H2. Idempotency lookups are not tenant-scoped

**Where:** `src/app/api/transactions/route.ts:223` and `:702`;
`src/app/api/payments/route.ts:117` and `:249`

```ts
const existing = await db.transaction.findUnique({
  where: { clientMutationId },
  include: { items: true, party: true },   // ← full invoice returned
})
if (existing) return NextResponse.json({ transaction: existing, idempotent: true })
```

No `userId` check. `clientMutationId` is globally unique across tenants. This is safe *only*
as long as every client generates cryptographically random IDs forever. The moment any
client (a future React Native build, a bulk importer, a partner integration) uses a
timestamp, counter, or `deviceId + seq`, one shop can read another shop's invoice with
line items and party details.

**Fix:** add `userId` to the `where`, and return `409 Conflict` if the ID exists under a
different user rather than silently leaking.

### H3. `int4` overflow will 500 the insights endpoint

**Where:** `src/app/api/insights/route.ts:107`

```sql
SUM(ROUND(ti."quantity"::numeric * ti."unitPrice"::numeric, 0))::int AS "totalRevenuePaise"
```

Postgres `int` caps at 2,147,483,647 **paise** = **₹21,47,483.65**. One product crossing
~₹21.5 lakh of sales in a 30-day window makes the whole `/api/insights` request throw
`integer out of range` → 500. That is an ordinary month for a mid-size wholesaler.

**Fix:** `::bigint`, and read it with `Number()` as the neighbouring queries already do.
Worth grepping for other `::int` casts on paise sums — the same pattern may exist elsewhere.

### H4. `splitGstPaise` gives the odd paisa to a different tax on negative amounts

**Where:** `src/lib/money.ts:406-411`

```ts
const cgst = Math.ceil(gst / 2)   // 18001 → 9001 (CGST gets it)  ✅ matches docs
const sgst = gst - cgst           // −18001 → cgst −9000, sgst −9001  ❌ SGST gets it
```

Not reachable today because taxable amounts are non-negative. It becomes live the moment a
credit note carries negative GST, and it would produce a CGST/SGST asymmetry in GSTR-1 that
is very hard to trace back. Use a sign-aware split.

---

## 3. Medium

### M1. `confirmOversell` produces a factually wrong error message
`src/app/api/transactions/route.ts:377,421` vs `:642-658`. Sending `confirmOversell: true`
skips warning generation *and* the 400 pre-check, but the in-transaction `stockPolicy ===
'block'` guard still runs and throws `STOCK_BLOCK`, whose message reads *"Another sale just
took the last N units of X"*. The user clicked "continue anyway" and is told a race
condition occurred. Either honour the override in block mode, or reject it up front with an
honest message.

### M2. Income/expense edit silently drops fields
`src/app/api/transactions/[id]/route.ts:193-205`. POST writes `partyId`, `payeeName`,
`payeePhone`, `createdByUserId`; the PUT income/expense branch writes none of them. Editing
an income/expense cannot change or clear the party. Separately, income/expense are excluded
from party balance entirely, so attaching a party to them has no ledger effect — likely to
confuse users who expect an expense against a supplier to move that supplier's balance.

### M3. "Top products" disagrees between Dashboard and Analytics
`dashboard/route.ts:289-305` nets credit notes; `analytics/route.ts:42-60` does not. Both
compute revenue as `qty × unitPrice` (ex-GST, ex-discount) while the headline revenue KPI
uses `totalAmount` (incl. GST, net of discount). Three different revenue definitions on
screens a shopkeeper reads side by side. Pick one definition, name it, and use it everywhere.

### M4. `distributeDiscountProportionally` can silently break its own invariant
`src/lib/money.ts:171-181`. The residual is added to the last non-zero-gross item and then
clamped to `[0, gross]`. When the clamp binds, `Σ shares ≠ discount`, so
`subtotal − Σ(item discounts) ≠ subtotal − orderDiscount` and the header no longer ties to
the lines — the exact property the docblock promises ("guarantees Σ(shares) === discount
exactly"). Rare, but it fails silently. Spread the residual across remaining items instead
of dumping it on one, and assert the invariant in a test.

### M5. SQL console hardening gaps (admin)
`src/lib/database-admin.ts`. The design is sound overall — fails closed without
`READONLY_DATABASE_URL`, SELECT/WITH whitelist, statement timeout, audit-logged. Two nits:
- `` `${cleanSql} LIMIT ${MAX_ROWS + 1}` `` breaks any query that already has `LIMIT`/`OFFSET`.
  Wrap in a subselect instead.
- The blocklist has `PG_READ_FILE` but the word-boundary regex will not match
  `pg_read_binary_file`. Harmless against a correctly-privileged read-only role, but the
  list creates false confidence — the DB role is the real control, so say that and stop
  extending the blocklist.

### M6. Payments have no edit and no restore
`src/app/api/payments/[id]/route.ts` implements soft DELETE, but there is no restore
endpoint (transactions have one at `transactions/[id]/restore`). A mis-clicked deletion can
only be undone by re-creating the payment, which changes `createdAt` and breaks the audit
narrative. Add restore for symmetry.

### M7. 11 test suites silently fail to load without `DATABASE_URL`
`src/lib/db.ts:17` constructs `PrismaClient` at module scope. Suites that transitively
import it die with `PrismaClientConstructorValidationError` and are reported as "failed to
run" rather than as regressions. If CI ever loses that env var you lose 11 suites' worth of
coverage — including `profit-leak-route-sweep` and `subscription` — without an obvious
signal. Make the client lazily constructed, or set a dummy URL in `jest.setup.ts`.

---

## 4. Low / hygiene

- **L1.** `src/app/api/debug/*` (8 routes) ship in the production bundle. They are founder-gated and
  additionally require `ALLOW_REPAIR_ENDPOINTS`, which is good, but excluding them at build
  time for production would be better.
- **L2.** `payment/verify` compares the Razorpay signature with `!==`
  (`src/app/api/payment/verify/route.ts:71`) while `payment/webhook` correctly uses
  `crypto.timingSafeEqual`. Make them consistent.
- **L3.** The `linkedNotes` pre-check in transaction DELETE is not `userId`-scoped. Safe today
  because the parent id is ownership-checked first, but it is the only unscoped query left in
  that file and it reads as an oversight.
- **L4.** `/api/announcements` swallows all DB errors and returns `{ announcements: [] }`,
  so a real outage looks identical to "no announcements".
- **L5.** Now that storage is fully paise, a large share of the ~180 `roundMoney()` calls
  operate on values that are already exact integers. Harmless, but it obscures which call
  sites still genuinely need float correction.

---

## 5. What is genuinely good

Worth stating plainly, because it shapes where you should spend effort next:

- **Concurrency handling is better than most production ledgers I've read.** `SELECT … FOR
  UPDATE` before edit/delete, note-cap validation moved *inside* the transaction, invoice
  counter as an atomic upsert, and the P2002 recovery that jumps the counter past
  manually-numbered legacy bills rather than crawling — that last one is a real-world failure
  mode most teams discover in production.
- **Tenant scoping is disciplined.** I swept every `where: { id }` write in the app; all of
  them are preceded by an ownership-checked fetch. The only gaps are the idempotency lookups
  in H2.
- **The admin panel is well-hardened**: `withAdmin` on every route except the four that must
  be public, a build-enforced route-policy matrix, step-up auth on sensitive routes, SQL
  console that fails closed, setup endpoint behind `SETUP_SECRET` + `timingSafeEqual`, and a
  login-probe designed specifically to avoid becoming an enumeration oracle.
- **Soft-delete is applied consistently** across Transaction, Payment, and Party, with
  `deletedAt: null` filters in the balance paths.

---

## 6. Coverage statement — read this

This is **pass 1**, and I want to be exact about what it does and does not cover, because
you asked for "every single issue" and no single pass over 161k lines can honestly claim that.

**Audited in depth:** the money conversion layer end-to-end; party balance and
receivable/payable; line-item and GST math; transaction create/edit/delete/stock/atomicity;
payments; Razorpay create-order → verify → webhook → subscription upgrade; auth, session,
JWT revocation and impersonation; tenant scoping across all API routes; admin authz, SQL
console, and setup/login paths.

**Not yet audited — these are the gaps I'd close in pass 2:**

| Area | Why it matters |
|---|---|
| GSTR-1 / GSTR-3B / GSTR-2B builders (`gstr1-builder.ts`, `gstr-3b`, `gstr-export`) | ~2,000 lines of filing logic. Wrong output here is a compliance liability, not just a UX bug. **Highest-value next target.** |
| Offline sync (`offline-db.ts`, `offline-fetch.ts`, queue replay, conflict resolution) | The idempotency findings in H2 are the entry point; the replay/conflict semantics themselves are unreviewed. |
| Backup / restore / import (`restore-utils.ts`, `import/restore`, `export/full`) | Restore is the single most destructive operation a user can invoke. |
| Reports, PDF/invoice generation, Tally export, `consolidated-reports.ts` | Customer-facing numbers; must tie to the ledger. |
| Bank reconciliation matching logic (`bank-recon.ts`, `reconciliation.ts`) | Auto-match on amount + date ±2 days is a classic source of silent mis-matching. |
| Staff permissions matrix (`staff-permissions.ts`) — behavioural, per-module | I verified it is *called* on every route; I did not verify the matrix itself is correct. |
| Admin: bulk jobs, break-glass, webhook engine, fraud rules, revenue recognition | ~15k LOC of admin business logic, largely unexamined. |
| The Android/Capacitor layer, e2e specs, and all React UI components | No review at all. |

**Recommended order for pass 2:** GST filing builders → restore/import → offline sync
conflict semantics → bank reconciliation → staff permission matrix → admin business logic.

---

## 7. Suggested fix order

**Before launch (blocking):**
1. C1 — decide and execute the corrupted-payment remediation
2. C4 — one-line `maxAge` fix on impersonation
3. H1 — move the rate limit to POST
4. H2 — scope idempotency lookups by `userId`
5. H3 — `::bigint`
6. C3 — inclusive-GST rounding identity

**Before scale (weeks, not days):**
7. C2 — remove the unbounded payment scan
8. C5 — decide the payment/paidAmount model (this is a product decision, not just code)
9. M1–M4

**Then:** pass 2 on the areas in §6.
