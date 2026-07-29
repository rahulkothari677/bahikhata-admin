# RUNBOOK — locked out of the admin panel

**For: "I cannot get into the admin panel and there is nobody else who can."**

Written 2026-07-28 (master report §C4). Review every 6 months.

---

## Read this first

The admin panel is deliberately strict: password + TOTP, sessions revocable,
roles re-checked against the database on every request. That strictness is why
a lockout is a real possibility rather than a theoretical one.

**There is no "forgot my 2FA" button, and there should not be.** Anything that
could let *you* back in without the second factor could let an attacker in the
same way. The recovery path is the database, and the whole point of this
document is that the database credentials must be reachable **without** the
admin panel.

> ⚠️ **Do this before you ever need it:** put the Neon database password in
> your password manager, and set an emergency-access contact on that password
> manager. If the only copy of the password is in your head or on the laptop
> you just lost, this runbook cannot help you.

---

## Which situation are you in?

| Symptom | Go to |
|---|---|
| Password works, phone lost / authenticator app gone | **A** |
| Password forgotten, phone still works | **B** |
| Both gone | Do **A**, then **B** |
| "Too many login attempts" | **C** |
| Login page loads but every action fails | **D** |

---

## A. Lost the phone / authenticator (TOTP)

This clears the second factor so you can log in with the password alone, then
immediately re-enrol.

1. Open **https://console.neon.tech** → your project → **SQL Editor**.
2. Confirm which account you are fixing:

   ```sql
   SELECT id, email, role, "totpEnabled" FROM "AdminUser" WHERE email = 'rahulkothari677@gmail.com';
   ```

3. Clear the second factor:

   ```sql
   UPDATE "AdminUser"
   SET "totpEnabled" = false,
       "totpSecret"  = NULL,
       "tokenVersion" = "tokenVersion" + 1
   WHERE email = 'rahulkothari677@gmail.com';
   ```

   `tokenVersion + 1` signs out every existing session for that account. Do not
   skip it: if the lockout is because someone else has your session, leaving old
   sessions alive hands the account straight back to them.

4. Log in with your password. The panel will walk you through enrolling a new
   authenticator.
5. **Re-enrol immediately.** An admin account with no second factor is one
   password away from being taken — do not leave it overnight.

---

## B. Forgotten password

You cannot read the old password; nobody can. Replace the hash.

1. Generate a bcrypt hash of a new password. On any machine with Node:

   ```bash
   npx -y bcryptjs-cli hash 'YOUR-NEW-PASSWORD-HERE' 12
   ```

   If that package is unavailable, in a Node REPL: `require('bcryptjs').hashSync('YOUR-NEW-PASSWORD', 12)`.

   The result starts with `$2a$` or `$2b$` and is 60 characters long. If yours
   is not, it is not a bcrypt hash and login will fail.

2. In the Neon SQL Editor:

   ```sql
   UPDATE "AdminUser"
   SET "passwordHash" = '<paste the $2b$... hash>',
       "tokenVersion" = "tokenVersion" + 1
   WHERE email = 'rahulkothari677@gmail.com';
   ```

3. Log in with the new password.

> Never paste the plaintext password into SQL, a ticket, or a chat window. Only
> the hash goes into the database.

---

## C. "Too many login attempts"

Brute-force protection has locked the account. This is **not** broken — it is
the control working.

- **Simplest fix: wait.** The window is 5 minutes for login, 5 for TOTP.
- If you cannot wait, clear the counter in Upstash: **https://console.upstash.com**
  → your database → **Data Browser** → delete the key beginning
  `admin-login:` (or `admin-totp:`) that contains your email.
- If Redis is not configured, the counter lives in server memory and clears
  itself on the next cold start — waiting is the only option.

**If you did not cause these attempts, someone else is trying to get in.** Do
not just clear the counter: rotate the password (**B**), which also invalidates
every session.

---

## D. Logged in but everything fails

Usually the database, not your account.

1. Check **https://bahikhata-admin.vercel.app/api/status** — it needs no login.
2. `"database": "operational"` with a high `responseTimeMs` on the first
   request is a **Neon cold start**, not an outage. Reload once; a warm read is
   ~3ms. (Measured 2026-07-28: 868ms cold, 3ms warm.)
3. Check the Neon console for a suspended or over-quota project.
4. Check Sentry for the underlying error.

**If the error names a column that does not exist** — e.g.
`The column AdminUser.stepUpVerifiedAt does not exist` — that is schema drift:
code deployed ahead of a migration. This has happened twice. Fix:

```bash
cd ~/bahikhata-pro && npx prisma migrate deploy
```

Migrations live in the **main app** repo and are applied by its build. The admin
app never applies them. Before deploying any admin change that touches the
schema, run:

```bash
DATABASE_URL="<production url>" npx tsx scripts/check-schema-drift.ts
```

---

## The nuclear option: no admin accounts at all

If every admin row is gone or unusable, `/api/admin/setup` can bootstrap the
first account. It is disabled once an admin exists, and requires `SETUP_SECRET`
from the admin app's Vercel environment variables.

If that fails too, insert an admin row directly, using a bcrypt hash from **B**:

```sql
INSERT INTO "AdminUser" (id, email, name, "passwordHash", role, "totpEnabled", "tokenVersion", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'rahulkothari677@gmail.com', 'Rahul', '<bcrypt hash>', 'founder', false, 0, now(), now());
```

The email must also be present in `FOUNDER_EMAILS` in the admin app's Vercel
environment, or the role check will refuse it.

---

## What you cannot do from here, by design

- **Read a user's password.** Only hashes are stored.
- **Recover the backup passphrase.** If it is lost, the encrypted backups are
  permanently unreadable. It belongs in your password manager, today.
- **Undo a hard delete of a user's books.** There is no hard delete: the
  database role has `DELETE` and `TRUNCATE` revoked, and every removal is a
  soft delete. Restoring means clearing `deletedAt`, not recovering from tape.

---

## Prevention checklist

- [ ] Neon database password in a password manager, with an emergency contact
- [ ] Backup passphrase in the same place
- [ ] TOTP enrolled on **two** devices, or recovery codes printed and stored offline
- [ ] `SETUP_SECRET` recorded somewhere reachable without the panel
- [ ] This runbook tried once, on purpose, while nothing is on fire

The last item is the one people skip. A recovery procedure nobody has ever run
is a guess, not a procedure.
