# Architecture Deep Dive — How the System Handles Millions of Users

**Purpose:** This document explains (in simple language) how the admin panel handles massive scale, where data is stored, how computations work, and why investors/banks can trust the data.

**Last updated:** July 3, 2026

---

## 1. Where Does All the Data Live?

**Not on your laptop. On a cloud database.**

```
Your laptop (browser)          Vercel (cloud server)          Neon (cloud database)
┌─────────────────┐           ┌──────────────────┐           ┌─────────────────────┐
│                 │           │                  │           │                     │
│  You open       │  request  │  Admin panel     │  query    │  All user data      │
│  admin panel    │ --------> │  code runs here  │ --------> │  lives here         │
│  in Chrome      │           │  (Next.js)       │           │  (PostgreSQL)       │
│                 │  <-------- │                  │  <-------- │                     │
│  See dashboard  │  response │                  │  data     │  Millions of rows   │
│                 │           │                  │           │  stored permanently │
└─────────────────┘           └──────────────────┘           └─────────────────────┘
```

- **Your laptop**: Only displays data (like a TV screen). Doesn't store or compute anything.
- **Vercel (cloud server)**: Runs the admin panel code. Receives your clicks, sends queries to database, returns results.
- **Neon (cloud database)**: Stores ALL data permanently. Runs 24/7. Even when your laptop is off, users are still transacting.

---

## 2. Where Is Data Stored Throughout the Day?

Every time a user does anything in the main app:

| User Action | What Gets Stored | Where |
|------------|-----------------|-------|
| User signs up | New row in `User` table | Neon database |
| User adds a transaction | New row in `Transaction` table | Neon database |
| User scans a bill with AI | New row in `AiUsageLog` table | Neon database |
| User pays for subscription | New row in `Subscription` table | Neon database |
| User reports a problem | New row in `SupportTicket` table | Neon database |

The database is always running — like a giant filing cabinet that never closes.

---

## 3. Will the 2 AM Job Crash When Processing Billions of Rows?

### COUNT and SUM Don't Read Every Row

**What most people think:** Load all 10 crore rows → count one by one → CRASH

**What databases actually do:** The database maintains an internal counter. `COUNT(*)` reads the counter → returns instantly. The database NEVER loads all rows into memory.

Think of it like a bank: when you ask "what's my balance?", the bank doesn't re-count every transaction. It reads the current balance number.

### Heavy Jobs Use Two Techniques:

**Technique 1: Chunking** — Process 500 users at a time, save results, move to next batch. Even at 1 crore users, never more than 500 users in memory.

**Technique 2: groupBy** — Ask the database to do the math internally. Returns only results (one row per user), not raw transactions.

### Will It Crash at Different Scales?

| Scale | Will It Crash? | Solution |
|-------|---------------|----------|
| 10,000 users | No | Queries take <1 second |
| 100,000 users | No | Queries take 3-5 seconds |
| 1,000,000 users | Maybe on Vercel (10s limit) | Move cron to GitHub Actions/Railway |
| 10,000,000 users | Yes on Vercel | Use dedicated server |

**The code is the same. Only the hosting changes.**

---

## 4. Will All Data Be Correctly Computed?

**Yes — for 4 reasons:**

1. **Database ACID guarantees** — Transactions are atomic, consistent, isolated, durable. Even if power goes out, data is safe.
2. **Data Verification button** — Cross-checks cached numbers vs live database. Shows ❌ if mismatch.
3. **No manual data entry** — Every number comes from a database query. No human ever types a number.
4. **Audit trail** — Every admin action permanently logged (who, when, what, from where).

---

## 5. Will Investors and Banks Trust This Data?

| What They Ask | What We Show | Why They Trust It |
|--------------|-------------|-------------------|
| "How many paying users?" | Subscriptions page (live count) | From database, not Excel |
| "What's your revenue?" | Financial Reports → P&L | Accrual accounting (CA-approved) |
| "Which users good for lending?" | Credit Scores (300-900 scale) | 5-factor model, verifiable data |
| "Can you verify bank data?" | Account Aggregator | RBI-regulated, user consent |
| "Is the app reliable?" | Public Status Page | Real-time service health |
| "Are you monitoring problems?" | Anomaly Detection | Auto-flags drops/spikes |
| "Can I verify your numbers?" | Data Verification button | Cross-checks cached vs live |
| "Who changed what?" | Audit Log | Every action permanently logged |

---

## 6. Revenue Streams

| Stream | Revenue | How |
|--------|---------|-----|
| Lending Leads | ₹200/₹150/₹100 per lead | Credit scores → NBFC partners via webhooks |
| Supplier Reports | ₹50K-₹1L per report | Anonymized market data for FMCG companies |
| GST Filing | ₹500-₹2K per filing | Transaction data → GST returns |
| AA Reports | ₹50-100 per report | Bank data verification for NBFCs |
| Subscriptions | ₹299/₹599 per month | Pro/Elite plans |
| **Total at scale** | **₹50L+/month** | **₹6+ crore/year** |

---

## 7. Infrastructure Costs vs Revenue

| Scale | Monthly Cost | Monthly Revenue | Margin |
|-------|-------------|----------------|--------|
| 10K users | ₹0 (free) | ₹3L (10% paid × ₹299) | 100% |
| 100K users | ~₹2,000 | ₹30L | 99.3% |
| 1M users | ~₹10,000 | ₹3Cr | 99.97% |
| 10M users | ~₹50,000 | ₹30Cr | 99.98% |

**Revenue far exceeds cost at every scale.**

---

## 8. Admin Control Over Main App

### ✅ Available Now:
- Turn off any feature (Feature Flags → toggle → main app checks)
- Change user's plan (Users page → updates shared DB)
- Ban/deactivate users (Bulk Operations)
- Send notifications (SMS/Email/Push)
- Run campaigns (multi-step sequences to segments)
- Export user data (GDPR/DPDP)
- Impersonate users (founder only, 5-min token)
- Monitor AI costs (per-user tracking)
- Track all actions (permanent audit trail)

### ⚠️ Needs Main App Changes (Future):
- Per-user custom limits
- Remote config (change behavior without deploy)
- Force-update main app
- Change subscription price dynamically
- View user's transactions in admin

---

## 9. Pre-Computed Tables

| Table | What It Stores | When Updated | Why |
|-------|---------------|--------------|-----|
| `DailyStats` | User count, revenue, AI cost | Nightly 2 AM | Dashboard loads <100ms |
| `CreditScoreCache` | User credit scores | On-demand | Avoid N+1 queries |
| `UserSegmentCache` | User segments | Nightly 3 AM | Segment page instant |
| `ChurnPrediction` | Churn risk scores | Nightly 6 AM | Churn page instant |
| `RevenueSchedule` | Monthly revenue entries | On subscription | Financial reports instant |

---

## 10. Background Jobs (Cron)

| Job | When | Duration | Purpose |
|-----|------|----------|---------|
| Daily Stats | 2 AM | <5s | Pre-compute dashboard KPIs |
| User Segments | 3 AM | <30s | Categorize users into 10 segments |
| Credit Scores | 4 AM | <60s | Score all users (5 bulk groupBy) |
| Anomaly Detection | 5 AM | <10s | Check 7 metrics for spikes/drops |
| Churn Prediction | 6 AM | <60s | Score all users on 6 risk factors |
| Fraud Rules | Every 15 min | <10s | Evaluate fraud rules |
| Webhook Delivery | Every 1 min | <10s | Send pending webhooks |
| Bulk Jobs | Every 5 min | <10s | Execute scheduled operations |

All jobs use chunking (500 users/batch) + timeout (5-10s) + retry (Neon sleep).
