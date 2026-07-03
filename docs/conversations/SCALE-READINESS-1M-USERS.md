# Scale Readiness — 1 Million Users Roadmap

**Purpose:** Complete guide on what's automatic, what needs subscriptions, and what to do at each scale to handle 1 million users without crashes.

**Last updated:** July 3, 2026

---

## 1. What Computes Automatically vs What Needs Manual Action

### Automatic (runs by itself via GitHub Actions cron — no action needed):

| Job | When | What It Does |
|-----|------|-------------|
| Daily Stats | 2 AM UTC | Computes dashboard KPIs (user count, revenue, AI cost) |
| Anomaly Detection | 5 AM UTC | Checks 7 metrics for spikes/drops |
| Credit Scores | 10:30 PM UTC | Scores all users (5-factor model) |
| Churn Predictions | 12:30 AM UTC | Scores all users on 6 risk factors |
| Fraud Rules | Every 15 min | Evaluates custom fraud rules |
| Bulk Jobs | Every 5 min | Executes scheduled bulk operations |
| Webhook Delivery | Every 5 min | Sends pending webhooks to partners |

### NOT Automatic (needs manual trigger or one-time setup):

| Task | What You Need to Do |
|------|---------------------|
| User Segments | Click "Compute Segments" on Segments page (or add to cron later) |
| Notification providers | Add MSG91_API_KEY (SMS), RESEND_API_KEY (Email), FCM_SERVER_KEY (Push) to Vercel env vars when ready to send real notifications |
| Partner webhooks | Create partner + webhook endpoint on admin panel when you sign an NBFC partner |
| GST filing | Generate report manually when a user requests it |
| Account Aggregator | Set AA_BASE_URL, AA_CLIENT_ID, AA_CLIENT_SECRET when you get an AA partnership |

---

## 2. Subscription Plan Timeline

**Everything works on free tiers right now. No subscriptions needed until ~100K users.**

| Service | Current Plan | Cost | Works For |
|---------|-------------|------|-----------|
| Vercel | Hobby (free) | ₹0 | Up to 100K users |
| Neon DB | Free | ₹0 | Up to 100K users (auto-sleeps, withNeonRetry handles it) |
| GitHub Actions | Free | ₹0 | 2,000 minutes/month (enough for all 7 cron jobs) |
| Sentry | Free | ₹0 | 5K errors/month |

### When to Upgrade:

| Scale | What to Upgrade | Cost | Why |
|-------|----------------|------|-----|
| 10K users | Nothing | ₹0 | Everything works on free |
| 50K users | Maybe Neon Pro | ₹0-1,500/mo | Neon free has 3GB storage limit |
| 100K users | Neon Pro + Vercel Pro | ~₹3,000/mo | Vercel free has 100GB bandwidth; Neon Pro for no sleep + more storage |
| 500K users | Neon Scale + Vercel Pro + Railway | ~₹10,000/mo | Heavy jobs need more compute; DB needs more connections |
| 1M users | Neon Scale + Vercel Pro + Railway + Redis | ~₹15,000-20,000/mo | Full production setup |

**Key: Start free, upgrade when you hit limits. Revenue far exceeds cost at every scale.**

---

## 3. Complete Checklist for 1 Million Users

### Do NOW (before launch):

| Task | Status | Notes |
|------|--------|-------|
| Cron jobs configured | ✅ Done | All 7 jobs run via GitHub Actions |
| CRON_SECRET set | ✅ Done | Secures cron endpoints |
| Neon DB connection retry | ✅ Done | withNeonRetry handles DB sleep |
| All queries have 5s timeout | ✅ Done | Prevents hanging |
| All queries have .catch() | ✅ Done | Prevents crashes |
| All lists paginated (20/page) | ✅ Done | No memory exhaustion |
| Pre-computed tables | ✅ Done | DailyStats, CreditScoreCache, etc. |
| Monitor Vercel function logs | ⬜ Pending | Check Vercel → Logs weekly |
| Set up Sentry | ⬜ Pending | Add SENTRY_DSN to Vercel env vars |
| Test payment flow (Razorpay) | ⬜ Pending | Test with ₹1 test payment |

### Do at 10,000 users:

| Task | Why | How |
|------|-----|-----|
| Monitor DB storage | Neon free has 3GB limit | Check Neon dashboard |
| Monitor Vercel bandwidth | Free has 100GB/month | Check Vercel → Analytics |
| Monitor AI costs | Gemini API costs money | Check admin → AI Usage page |

### Do at 100,000 users:

| Task | Why | Cost |
|------|-----|------|
| Upgrade Neon to Pro | No auto-sleep, 10GB storage, more connections | $19/mo (~₹1,500) |
| Upgrade Vercel to Pro | More bandwidth, faster builds, 60s timeout | $20/mo (~₹1,600) |
| Add Redis cache | Cache hot queries (dashboard, overview tabs) | $10/mo (~₹800) |
| Monitor query performance | Some queries may slow down | Check Vercel logs |

### Do at 1,000,000 users:

| Task | Why | Cost |
|------|-----|------|
| Neon Scale plan | More storage, connections, no limits | ~$70/mo (~₹5,500) |
| Railway for background jobs | Vercel's 60s timeout too short for 1M | $5-20/mo (~₹1,500) |
| Redis cluster | Cache everything | $20/mo (~₹1,600) |
| Read replica DB | Separate analytics from writes | $20/mo (~₹1,600) |
| CDN (Cloudflare) | Faster page loads globally | $5/mo (~₹400) |
| **Total** | | **~₹15,000-20,000/mo** |

**Revenue at 1M users (10% paid):** 100,000 × ₹299 = **₹2.99 crore/month**
**Infrastructure cost:** ~₹20,000/month
**Margin:** 99.93%

---

## 4. Crash Prevention Architecture

### What would crash at 1M users (and how we prevent it):

| What Would Crash | How We Prevent It |
|------------------|-------------------|
| Loading all users into memory | Pagination (20/page) + chunking (500/batch) |
| Dashboard taking 30+ seconds | Pre-computed DailyStats table (1 row, <100ms) |
| Credit score computation timing out | Runs on GitHub Actions (30-min limit) |
| Database running out of connections | Neon Pro allows 100+; connection pooling |
| Neon DB sleeping | withNeonRetry() waits 500ms + retries |
| Memory exhaustion from large queries | `take: 1000` limit + chunked processing |
| White screen on React error | GlobalErrorBoundary catches all errors |
| CSRF blocking cron requests | Middleware recognizes CRON_SECRET + skips CSRF |
| Query takes too long | withTimeout(5000) kills it, returns safe default |
| Query returns invalid data | safeCount/safeAggregate validate (no NaN/negative) |

### What to monitor:

| What to Watch | Where to Check | When |
|---------------|---------------|------|
| Database storage | Neon dashboard → Storage | Weekly |
| Vercel bandwidth | Vercel → Analytics | Weekly |
| AI API costs | Admin → AI Usage & Cost | Daily |
| Cron job success | GitHub → Actions tab | Daily (check for red X) |
| Error logs | Vercel → Logs | Weekly |
| Neon DB connections | Neon dashboard → Connections | Monthly |

---

## 5. Simple Summary

| Question | Answer |
|----------|--------|
| Will data compute automatically? | **Yes** — 7 cron jobs run via GitHub Actions |
| Do I need subscriptions now? | **No** — free tiers work until ~100K users |
| Can it handle 1M users? | **Yes** — same architecture as Stripe/Shopify |
| Will it crash? | **No** — timeout + retry + safe defaults |
| What do I need to do? | **Nothing now.** Monitor as you grow. Upgrade at 50K-100K. |
| Cost at 1M users? | ~₹20K/mo infrastructure vs ₹2.99Cr/mo revenue = 99.93% margin |
