# Deployment Guide — BahiKhata Pro Admin Panel

## Prerequisites

1. **GitHub repo** — code pushed to `rahulkothari677/bahikhata-admin`
2. **Neon PostgreSQL database** — free tier at https://neon.tech
3. **Vercel account** — free tier at https://vercel.com
4. **Domain** (optional) — e.g. `admin.bahikhata.pro`

## Step-by-Step Deployment

### 1. Create Neon Database

1. Go to https://neon.tech → Sign up
2. Create new project → name it `bahikhata-pro`
3. Copy the connection string (looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`)
4. Save this — you'll need it for both repos

### 2. Deploy Admin Panel to Vercel

1. Go to https://vercel.com → Sign up with GitHub
2. Click "Add New" → "Project"
3. Import `rahulkothari677/bahikhata-admin`
4. Configure:
   - **Framework Preset:** Next.js
   - **Root Directory:** `./` (default)
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `.next` (default)
5. Add Environment Variables (see [environment-variables.md](./environment-variables.md)):
   - `DATABASE_URL` — your Neon connection string
   - `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
   - `NEXTAUTH_URL` — `https://your-project.vercel.app` (update after custom domain)
   - `FOUNDER_EMAILS` — your email(s)
6. Click "Deploy"
7. Wait for build to complete (2-3 minutes)

### 3. Push Database Schema

After first deploy, the database tables need to be created:

```bash
cd bahikhata-admin
npx prisma db push
```

This creates all tables (User, Transaction, AdminUser, etc.) in your Neon database.

**IMPORTANT:** Also run this from the main app repo, so both schemas are in sync:

```bash
cd bahikhata-pro
npx prisma db push
```

### 4. Create Admin Account

1. Visit your deployed admin URL: `https://your-project.vercel.app`
2. You'll be redirected to `/setup` (first-time setup)
3. Sign up with a founder email (must match `FOUNDER_EMAILS` env var)
4. Set a strong password
5. Login

### 5. Set Up Custom Domain (Optional)

1. In Vercel dashboard → your project → "Settings" → "Domains"
2. Add `admin.bahikhata.pro` (or your domain)
3. Add the DNS records Vercel shows you (CNAME or A record)
4. Wait for DNS propagation (5-30 minutes)
5. Update `NEXTAUTH_URL` env var to `https://admin.bahikhata.pro`
6. Redeploy

### 6. Set Up Vercel Cron Jobs (Production)

Create `vercel.json` in project root:

```json
{
  "crons": [
    {
      "path": "/api/admin/compute-daily-stats",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/admin/anomalies/detect",
      "schedule": "0 5 * * *"
    },
    {
      "path": "/api/admin/fraud-rules/evaluate",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

**Note:** Cron endpoints need to be secured with a secret token. Add `CRON_SECRET` env var and check it in the API route.

---

## Updating the Admin Panel

When you push to `main` branch on GitHub:

1. Vercel auto-detects the push
2. Builds the project (2-3 minutes)
3. Deploys to production
4. Previous deployment is kept for instant rollback

### To rollback:
1. Vercel dashboard → "Deployments"
2. Find the last working deployment
3. Click "..." → "Promote to Production"

---

## Database Migrations

### When you add a new table to schema:

1. Add the model to `bahikhata-admin/prisma/schema.prisma`
2. Add the SAME model to `bahikhata-pro/prisma/schema.prisma` (CRITICAL!)
3. Run `npx prisma generate` in both repos
4. Run `npx prisma db push` in ONE repo (it updates the shared DB)
5. Commit + push both repos
6. Vercel auto-deploys both

**If you forget step 2:** The main app's `prisma db push` will DROP your new table!

### To reset database (DESTRUCTIVE — loses all data):

```bash
npx prisma db push --force-reset
npx prisma db seed  # if you have a seed script
```

---

## Monitoring

### Vercel Analytics
- Built into Vercel dashboard
- Shows: page views, unique visitors, top pages, Web Vitals

### Sentry Error Tracking
1. Create account at https://sentry.io
2. Create a Next.js project
3. Copy the DSN
4. Add `SENTRY_DSN` env var to Vercel
5. Configure `sentry.client.config.ts` + `sentry.server.config.ts` (already in repo)

### Uptime Monitoring
- Use the public `/status` page: `https://admin.bahikhata.pro/status`
- Set up external monitor (e.g. UptimeRobot, Pingdom) to ping this URL
- If status changes from "operational", get alerted

---

## Troubleshooting

### Build fails on Vercel

| Error | Cause | Solution |
|-------|-------|---------|
| `Prisma schema validation` | DATABASE_URL not set or wrong format | Add correct DATABASE_URL env var |
| `Type error` | TypeScript issue | Run `npx tsc --noEmit` locally to find the error |
| `Module not found` | Missing dependency | Run `npm install` locally, commit package.json |
| `prisma generate` fails | Schema syntax error | Check schema.prisma for syntax errors |

### Runtime errors

| Error | Cause | Solution |
|-------|-------|---------|
| 401 Unauthorized | Session expired or NEXTAUTH_SECRET changed | Login again |
| 500 Server Error | DB connection issue or code bug | Check Vercel function logs |
| White screen | React error | Check browser console + Sentry |
| Modal dark/unreadable | Chrome force-dark | Disable `chrome://flags/#enable-force-dark` |
| CSRF check failed | Origin header mismatch | Ensure NEXTAUTH_URL matches deployed URL |

### Database issues

| Error | Cause | Solution |
|-------|-------|---------|
| "Table does not exist" | Schema not pushed | Run `npx prisma db push` |
| "Column does not exist" | Schema out of sync | Run `npx prisma db push` |
| Connection timeout | Neon DB asleep (free tier) | First query wakes it up (may take 1-2s) |
| "Too many connections" | Connection pool exhausted | Check for unclosed transactions |

---

## Security Checklist

- [x] `NEXTAUTH_SECRET` set (different from main app)
- [x] `FOUNDER_EMAILS` set (only founders can create admin accounts)
- [x] HTTPS enforced (Vercel does this automatically)
- [x] Security headers set (in middleware.ts)
- [x] CSRF protection on mutations (in middleware.ts)
- [x] IP allowlist configured (optional but recommended)
- [x] 2FA enrolled (Settings → 2FA)
- [x] Audit logging enabled (all admin actions logged)
- [x] `robots: noindex, nofollow` (admin not indexed by Google)
- [ ] Rate limiting on login (future enhancement)
- [ ] Web Application Firewall (future enhancement)
