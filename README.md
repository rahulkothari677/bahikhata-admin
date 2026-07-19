# BahiKhata Pro — Admin Panel

Secure, isolated admin dashboard for managing the BahiKhata Pro ledger app.

## 🔒 Security Architecture

This admin panel is **completely separate** from the main app for security:
- **Separate GitHub repo** (this one — `bahikhata-admin`)
- **Separate Vercel account** (different email + 2FA)
- **Separate auth system** (own NextAuth + separate AdminUser table)
- **Founder-only access** (email whitelist, no public signup)
- **Read-only database** (can't modify user data directly)
- **Mandatory 2FA** (TOTP via Google Authenticator)
- **1-hour session timeout** (auto-logout)
- **IP allowlisting** (optional — restrict to your IPs)
- **Full audit trail** (every admin action logged permanently)

## ⚠️ CRITICAL: Database Migration Policy

**This app shares a production database with the main app (`bahikhata-pro`).**

The main app **owns all database migrations** — it runs `prisma migrate` on
every deploy via `migrate-with-retry.sh`. This admin app's `schema.prisma` is
a **read-model mirror** kept in sync FROM the main app's schema, used only for
Prisma client type generation (`prisma generate`).

### DO NOT run `prisma db push` from this repo.

`prisma db push` reconciles the database to THIS app's schema view. Because
the two schemas are maintained separately and will drift, a `db push` from
here can **drop or alter columns** the main app's migrations added but this
schema doesn't know about — causing **silent data loss** on the shared
production database.

### How to add/change a shared-table column:
1. Add the field to the **main app's** `prisma/schema.prisma`
2. Create a migration in the **main app** (`prisma migrate dev --name ...`)
3. Mirror the field in this admin app's `prisma/schema.prisma` (for types)
4. Run `npx prisma generate` here (client types only — NO `db push`)
5. The main app's deploy will apply the migration to the shared DB

## 🚀 Deployment Guide

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Set Up Environment Variables
Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

**Critical values to set:**

1. **DATABASE_URL** — Use a READ-ONLY database user (see Step 3)
2. **NEXTAUTH_SECRET** — Generate a new one:
   ```bash
   openssl rand -base64 32
   ```
3. **NEXTAUTH_URL** — Your admin URL (e.g., `https://admin.bahikhata.pro`)
4. **FOUNDER_EMAILS** — Your email (comma-separated for multiple)
5. **ADMIN_API_SECRET** — Generate another secret for main app communication

### Step 3: Create Read-Only Database User

Run this SQL in your Neon/Vercel Postgres console:

```sql
-- Create a read-only user for the admin panel
CREATE USER admin_readonly WITH PASSWORD 'your-strong-password-here';

-- Grant read access to all tables
GRANT CONNECT ON DATABASE bahikhata TO admin_readonly;
GRANT USAGE ON SCHEMA public TO admin_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO admin_readonly;

-- Make sure future tables are also readable
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO admin_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO admin_readonly;

-- Allow the admin app to write to its OWN tables (AdminUser, AdminAction)
-- These tables don't exist in the main app, so we need to create them
-- and grant write access specifically
GRANT INSERT, UPDATE, DELETE ON "AdminUser" TO admin_readonly;
GRANT INSERT, UPDATE, DELETE ON "AdminAction" TO admin_readonly;
```

**Important:** The `AdminUser` and `AdminAction` tables need write access (for admin login + audit logging). All other tables are read-only.

**Alternative:** If you can't create a read-only user, use the same `DATABASE_URL` as the main app. This is less secure but works for testing.

### Step 4: Run Database Migration
```bash
npx prisma db push
```

This creates the `AdminUser` and `AdminAction` tables (the only tables the admin app owns).

### Step 5: Deploy to Vercel
1. Push this repo to GitHub
2. In your **new Vercel account**, create a new project from this repo
3. Add all environment variables in Vercel → Settings → Environment Variables
4. Deploy

### Step 6: Create Your Admin Account
1. Visit `https://your-admin-url.vercel.app/setup`
2. Enter your name, email (must be in FOUNDER_EMAILS), and a strong password (min 12 chars)
3. Click "Create Admin Account"
4. You'll be redirected to `/login` — log in with your new credentials

### Step 7: Enable 2FA (Recommended)
After logging in, enable 2FA in your profile settings for maximum security.

## 📊 Features

### Phase 1 (Current)
- ✅ **Overview Dashboard** — Total users, DAU, MRR, GMV, AI cost, profitability
- ✅ **User Management** — List, search, filter, drill-down to full user detail
- ✅ **AI Usage Tracking** — Per-user, per-feature, per-provider cost breakdown
- ✅ **Plan Management** — Change any user's plan (with audit trail)
- ✅ **Feature Flags** — View all feature flags (toggle coming in Phase 2)
- ✅ **Subscriptions** — Active subscriptions, MRR, payment history
- ✅ **Audit Log** — Every admin action permanently recorded

### Phase 2 (Planned)
- Cohort retention analysis
- Churn tracking
- LTV calculation
- Revenue forecasting
- Feature flag toggling UI
- Push notifications
- User segmentation

### Phase 3 (Planned)
- Credit scoring dashboard
- Lending lead marketplace
- Account Aggregator integration
- GST filing service
- Supplier intelligence reports

## 🛡️ Security Checklist

- [x] Separate GitHub repo (private)
- [ ] Separate Vercel account (different email)
- [ ] 2FA enabled on Vercel account
- [ ] 2FA enabled on admin account (after setup)
- [ ] Read-only database user configured
- [ ] IP allowlist configured (recommended)
- [ ] FOUNDER_EMAILS set to your email only
- [ ] NEXTAUTH_SECRET generated (different from main app)
- [ ] ADMIN_API_SECRET generated (shared with main app)
- [ ] Custom domain configured (admin.bahikhata.pro)

## 🔧 Development

```bash
# Install dependencies
npm install

# Run in development (port 3001 to avoid conflict with main app on 3000)
npm run dev

# Type check
npm run type-check

# Build for production
npm run build
```

## 📁 Structure

```
src/
├── app/
│   ├── (admin)/              — All admin pages (protected by auth)
│   │   ├── page.tsx          — Overview dashboard
│   │   ├── users/            — User management
│   │   ├── ai-usage/         — AI cost tracking
│   │   ├── features/         — Feature flags
│   │   ├── subscriptions/    — Subscription management
│   │   └── audit-log/        — Admin action history
│   ├── login/                — Login page (public)
│   ├── setup/                — One-time setup (public)
│   └── api/
│       ├── auth/             — NextAuth
│       └── admin/            — Admin API routes
├── components/
│   └── admin/                — Admin-specific components
├── lib/
│   ├── auth.ts               — NextAuth config (founder-only)
│   ├── db.ts                 — Prisma client (read-only)
│   ├── founders.ts           — Email whitelist
│   ├── audit.ts              — Admin action logger
│   └── utils.ts              — Formatting utilities
└── middleware.ts             — Auth + security headers + CSRF
```

## 🆘 Troubleshooting

### "Access denied" on login
- Check your email is in `FOUNDER_EMAILS` env var
- Check your IP is in `ADMIN_IP_ALLOWLIST` (if set)

### "Setup already complete"
- An admin account already exists. To reset: clear the `AdminUser` table in your database
- `DELETE FROM "AdminUser";` — then visit `/setup` again

### "Database connection error"
- Check `DATABASE_URL` is correct
- Verify the database user has access (run the SQL in Step 3)

### Can't see user data
- The admin app uses READ-ONLY database access
- If you see "permission denied", the read-only user isn't configured correctly
- Re-run the SQL in Step 3

## 📞 Support

For issues or questions, contact: rahulkothari677@gmail.com
