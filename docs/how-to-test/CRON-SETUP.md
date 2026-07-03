# Cron Jobs Setup Guide

## What This Does

Background jobs run automatically on a schedule:
- **Light jobs** (fast, <5s): run on Vercel Cron
- **Heavy jobs** (slow, 30-60s at 1M users): run on GitHub Actions

## Step 1: Set CRON_SECRET in Vercel

1. Go to Vercel → `bahikhata-admin` → Settings → Environment Variables
2. Add new variable:
   - **Key:** `CRON_SECRET`
   - **Value:** Generate a random string (run `openssl rand -hex 32` in terminal)
   - **Environments:** Production ✓
3. Save

## Step 2: Set Secrets in GitHub

1. Go to GitHub → `rahulkothari677/bahikhata-admin` → Settings → Secrets → Actions
2. Add 2 secrets:
   - **ADMIN_URL** = `https://admin.bahikhata.pro` (or your Vercel URL)
   - **CRON_SECRET** = Same value as Step 1

## Step 3: Verify

### Test Vercel Cron (light jobs):
- After deploying, Vercel will auto-run light jobs on schedule
- Check Vercel dashboard → Functions → see cron invocations

### Test GitHub Actions (heavy jobs):
- Go to GitHub → `bahikhata-admin` → Actions tab
- Click "Admin Heavy Cron Jobs" → "Run workflow" → select "all"
- Watch the run complete

### Test manually from admin panel:
- Open admin panel → Data Monetization → "Recompute Scores"
- Should work as before (uses session auth, not CRON_SECRET)

## Job Schedule

### Vercel Cron (light jobs — auto-scheduled):
| Job | Schedule | What |
|-----|----------|------|
| Daily Stats | 2:00 AM daily | Pre-compute dashboard KPIs |
| Anomaly Detection | 5:00 AM daily | Check 7 metrics for spikes |
| Fraud Rules | Every 15 min | Evaluate fraud rules |
| Webhook Delivery | Every 1 min | Send pending webhooks |
| Bulk Jobs | Every 5 min | Execute scheduled operations |

### GitHub Actions (heavy jobs — auto-scheduled):
| Job | Schedule | What | Duration |
|-----|----------|------|----------|
| Credit Scores | 4:00 AM IST daily | Score all users (5 bulk groupBy) | ~30-60s at 1M |
| Churn Predictions | 6:00 AM IST daily | Score all users (6 risk factors) | ~30-60s at 1M |

## How Authentication Works

Each cron endpoint accepts 2 types of authentication:

1. **Admin session** (manual trigger from admin panel):
   - User is logged in → NextAuth session → authorized
   - Used when you click "Recompute" buttons

2. **CRON_SECRET** (automated trigger from cron):
   - Request has `Authorization: Bearer <secret>` header
   - Used by Vercel Cron and GitHub Actions
   - If CRON_SECRET is NOT set, falls back to session-only (all manual)

## Files Created

| File | Purpose |
|------|---------|
| `vercel.json` | Vercel Cron schedule (5 light jobs) |
| `.github/workflows/admin-heavy-cron.yml` | GitHub Actions schedule (2 heavy jobs) |
| `src/lib/resilience.ts` (updated) | Added `checkCronAuth()` helper |
| 7 API routes (updated) | Accept CRON_SECRET as alternative auth |

## What Changed in API Routes

Each of the 7 cron endpoints now has this at the top:

```typescript
const cronSecret = process.env.CRON_SECRET
const authHeader = req.headers.get('authorization')
const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
const session = isCron ? null : await getServerSession(authOptions)
if (!isCron && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

- If CRON_SECRET matches → skip session check → proceed (adminId = 'cron' for audit)
- If CRON_SECRET doesn't match → check session → proceed if logged in
- If neither → 401 Unauthorized

## No Impact on Existing Functionality

- ✅ Manual triggers from admin panel still work (session auth)
- ✅ All existing buttons ("Recompute", "Run Detection", etc.) work as before
- ✅ If CRON_SECRET is not set, cron endpoints fall back to session-only
- ✅ No code logic changed — only auth check expanded
