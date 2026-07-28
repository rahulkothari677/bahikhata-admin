# Runbook: restoring the database

**Read this before you need it.** A backup you have never restored is a
hypothesis, not a backup.

---

## The one thing to understand first

Neon's point-in-time restore does **not** overwrite your data. It creates a
**new branch** containing the database as it was at a chosen moment. Your live
branch is untouched until you deliberately switch to the new one.

That makes restore safe to practise. You should practise it.

---

## Before an incident: verify you can actually restore

Do this once now, and again after any major schema change.

1. Go to **console.neon.tech** → your project → **Branches**
2. Click **New Branch**
3. Under "Include data up to", pick a time ~1 hour ago
4. Name it `restore-drill-<today's date>`
5. Create it

Now check the restored copy actually contains data. In **SQL Editor**, switch
the branch dropdown (top of the editor) to your new branch and run:

```sql
SELECT
  (SELECT COUNT(*) FROM "User")        AS users,
  (SELECT COUNT(*) FROM "Transaction") AS transactions,
  (SELECT COUNT(*) FROM "AdminAction") AS audit_entries,
  (SELECT MAX("createdAt") FROM "Transaction") AS newest_transaction;
```

**What you want to see:** counts close to production, and
`newest_transaction` near the timestamp you picked.

**If counts are zero or wildly wrong**, the restore did not work the way you
expect — find that out now, not during an incident.

Delete the drill branch afterwards. It costs storage.

---

## Neon's retention window

Point-in-time restore only reaches back as far as your plan's history retention.
On the **Free** plan that is short — around 24 hours.

**This is the gap that matters.** Ransomware, a bad migration or a corrupted
import discovered on a Monday morning cannot be undone if it happened on Friday
and your window is 24 hours.

Check yours: **Project → Settings → History retention**.

If the answer is 24 hours, the honest position is that you can survive a
mistake you notice within a day, and not one you notice later.

---

## During an incident

**Do not delete anything. Do not "clean up". Do not run a fix script.**
Every one of those makes recovery harder and destroys evidence of what happened.

1. **Write down the time** you believe things were last correct. Restore
   precision depends entirely on this.
2. **Create a restore branch** at that timestamp (steps above). This is
   non-destructive — the live database keeps running.
3. **Verify the restored branch** with the query above, plus something specific
   to the incident. If invoices were deleted, count invoices.
4. **Compare** against live before switching. What exists in one and not the
   other tells you the blast radius.
5. **Only then** decide: point the app at the restored branch, or copy specific
   rows back.

Step 5 is the only irreversible one. Steps 1–4 cost nothing.

---

## Verifying the audit trail after any restore

The audit log is hash-chained. A restore rewinds it to an earlier state, which
is legitimate — but confirm it is internally consistent, so that a *later*
tamper check does not blame the restore:

```bash
npx tsx scripts/verify-audit-chain.ts
```

Expect `✅ Audit chain intact`. If it reports a break immediately after a
restore, capture the output before doing anything else.

---

## What is NOT backed up by Neon

- **Uploaded documents** (Cloudinary) — separate service, separate backup story
- **Environment variables / secrets** (Vercel) — keep them in a password manager
- **The Neon account itself** — if that is lost, so is everything

A database restore does not restore a shopkeeper's uploaded bill images. Worth
knowing before you promise anyone a full recovery.

---

## Quick reference

| Situation | Action |
|---|---|
| Routine drill | New branch at T-1h, run the count query, delete branch |
| Bad migration | Branch at just before the migration ran |
| Data deleted in error | Branch at just before the deletion; compare, then copy rows back |
| Suspected compromise | Branch immediately; do NOT clean up; preserve the current state as evidence |
