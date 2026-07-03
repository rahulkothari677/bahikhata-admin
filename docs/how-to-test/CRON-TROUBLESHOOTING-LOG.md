# Cron Setup Troubleshooting Log

**Purpose:** Record of issues encountered during cron setup and how they were resolved.

**Last updated:** July 3, 2026

---

## Issues Encountered (in order)

### Issue 1: Git Author Identity
- **Error:** "The Deployment was blocked because GitHub could not associate the committer with a GitHub user."
- **Cause:** Commits were authored as `Z User <z@container>` instead of `rahulkothari677@gmail.com`
- **Fix:** Changed git config to correct email + pushed new commit
- **Lesson:** Always verify git config before pushing

### Issue 2: Vercel Hobby Plan Cron Limit
- **Error:** "Hobby accounts are limited to daily cron jobs. This cron expression (*/15 * * * *) would run more than once per day."
- **Cause:** Vercel free plan only allows 1 cron job per day — our vercel.json had jobs running every 1/5/15 minutes
- **Fix:** Removed vercel.json entirely, moved ALL cron jobs to GitHub Actions (no such limit)
- **Lesson:** Check platform limits before configuring features

### Issue 3: Vercel Redeploy vs Auto-Deploy
- **Error:** Clicking "Redeploy" on Vercel rebuilt the SAME OLD COMMIT instead of latest code
- **Cause:** "Redeploy" = rebuild same commit. Only a new push triggers auto-deploy with latest code.
- **Fix:** Pushed new commits to trigger auto-deploy
- **Lesson:** Don't use "Redeploy" to get latest code — push a new commit instead

### Issue 4: Middleware Blocking Cron Endpoints (ROOT CAUSE of 401)
- **Error:** `{"error":"Unauthorized"}` (HTTP 401) from ALL cron endpoints
- **Cause:** `middleware.ts` checked ALL `/api/admin/*` routes for NextAuth session. Cron requests (with CRON_SECRET, no session) were blocked BEFORE reaching the API route's auth code.
- **Fix:** Added `CRON_PATHS` list to middleware. If request has valid CRON_SECRET → allow through (skip session check). If no CRON_SECRET → fall through to session check (manual trigger).
- **Lesson:** When API returns 401, check MIDDLEWARE FIRST, then secrets, then deployment status. The middleware is the first gate — if it blocks, nothing else matters.

---

## Debugging Order for Future 401 Errors

When any API endpoint returns 401 Unauthorized:

1. **Check middleware.ts** — Is the path in PUBLIC_PATHS or AUTH_PATHS? If not, middleware requires session.
2. **Check env vars on Vercel** — Is the secret (e.g., CRON_SECRET) actually set? Check Settings → Environment Variables.
3. **Check Vercel deployment** — Is the latest code deployed? Check Deployments page for correct commit hash + "main" label (not "Redeploy").
4. **Check GitHub secrets** — Are secrets in "Repository secrets" (not "Environment secrets")? Are names exactly correct?
5. **Check API route code** — Does the route accept the alternative auth method (CRON_SECRET)?
6. **Test with debug endpoint** — Use /api/admin/cron-debug to verify secrets are set and matching.

---

## Final Working Setup

### GitHub Actions (all 7 cron jobs):
File: `.github/workflows/admin-cron.yml`

| Job | Schedule | Endpoint |
|-----|----------|----------|
| Daily Stats | 2 AM UTC | /api/admin/compute-daily-stats |
| Anomaly Detection | 5 AM UTC | /api/admin/anomalies/detect |
| Credit Scores | 10:30 PM UTC | /api/admin/data-monetization/compute |
| Churn Predictions | 12:30 AM UTC | /api/admin/churn-predictions/compute |
| Fraud Rules | Every 15 min | /api/admin/fraud-rules/evaluate |
| Bulk Jobs | Every 5 min | /api/admin/bulk-jobs/execute |
| Webhook Delivery | Every 5 min | /api/admin/webhooks/deliver |

### Required Secrets:
- **GitHub (Repository secrets):** `ADMIN_URL` + `CRON_SECRET`
- **Vercel (Environment Variables):** `CRON_SECRET` (same value)

### Middleware (middleware.ts):
- CRON_PATHS list with 7 endpoints
- If CRON_SECRET matches → skip session + CSRF check
- If no match → fall through to session check (manual trigger)

### API Routes (7 endpoints):
- Each accepts CRON_SECRET as Bearer token
- If CRON_SECRET matches → skip session, use 'cron' as adminId for audit
- If no match → check session (manual trigger from admin panel)
