# Architecture Overview — BahiKhata Pro Admin Panel

## Two-Repo Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    BahiKhata Pro Ecosystem                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────┐    ┌──────────────────────┐       │
│  │  bahikhata-pro       │    │  bahikhata-admin     │       │
│  │  (Main App)          │    │  (Admin Panel)       │       │
│  │                      │    │                      │       │
│  │  - User-facing app   │    │  - Admin-only access │       │
│  │  - Next.js 16        │    │  - Next.js 16        │       │
│  │  - React + Tailwind  │    │  - React + Tailwind  │       │
│  │  - Prisma (Postgres) │    │  - Prisma (Postgres) │       │
│  │  - Capacitor (Android)│    │  - NextAuth (admin)  │       │
│  │                      │    │                      │       │
│  │  URL: bahikhata.pro  │    │  URL: admin.bahikhata│       │
│  │  Repo: rahulkothari  │    │  Repo: rahulkothari  │       │
│  │       677/bahikhata  │    │       677/bahikhata  │       │
│  │       -pro           │    │       -admin         │       │
│  └──────────┬───────────┘    └──────────┬───────────┘       │
│             │                            │                   │
│             │    Shared Database         │                   │
│             │    (Neon PostgreSQL)       │                   │
│             └────────────┬───────────────┘                   │
│                          │                                   │
│              ┌───────────▼───────────┐                       │
│              │  Shared Tables        │                       │
│              │  - User               │                       │
│              │  - Transaction        │                       │
│              │  - Subscription       │                       │
│              │  - AiUsageLog         │                       │
│              │  - AuditLog           │                       │
│              │  - AdminUser          │                       │
│              │  - DailyStats         │                       │
│              │  - NotificationTemplate│                      │
│              │  - NotificationLog    │                       │
│              │  - Campaign (+Step)   │                       │
│              │  - Incident (+Update) │                       │
│              │  - Anomaly            │                       │
│              │  - FraudRule (+Alert) │                       │
│              │  - Partner            │                       │
│              │  - + more             │                       │
│              └───────────────────────┘                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Critical: Shared Schema Rule

**Both repos MUST have identical Prisma schemas for shared tables.**

If you add a new table to the admin panel's `prisma/schema.prisma`, you MUST also add it to the main app's `prisma/schema.prisma`. Otherwise:

- Main app runs `prisma db push` → drops the admin's new table (because it's not in main app's schema)
- Admin panel crashes: "Table does not exist"

**Always update BOTH schemas when adding new tables.**

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 16 (App Router) | Server/client components, API routes |
| Language | TypeScript | Type safety, better DX |
| Database | Neon PostgreSQL | Serverless Postgres, free tier |
| ORM | Prisma | Type-safe queries, migrations |
| Auth | NextAuth.js | Admin-only auth, separate from main app |
| UI | Tailwind CSS 4 + shadcn/ui | Consistent design system |
| State | React Query (TanStack Query) | Server state, caching |
| Toasts | Sonner | User feedback |
| Icons | Lucide React | Consistent icon set |
| Charts | Recharts | Dashboard visualizations |
| Monitoring | Sentry | Error tracking |
| Hosting | Vercel | Serverless, auto-deploy from GitHub |

## Design System Components

All admin pages use these reusable components from `src/components/admin/ui.tsx`:

| Component | Purpose |
|-----------|---------|
| `PageHeader` | Title + description + action buttons |
| `KPIGrid` | Grid layout for KPI cards (max 4 per page) |
| `KPICard` | Metric card: label, value, delta, icon, sublabel |
| `ContentCard` | Container with title + action + children |
| `EmptyState` | Icon + title + description (when no data) |
| `Pagination` | Page navigation (prev/next + page info) |
| `SearchBar` | Server-side search input |
| `LoadingSkeleton` | Skeleton loader (not spinners) |
| `Badge` | Status/severity indicators |

## Resilience Layer

Every database query goes through `src/lib/resilience.ts`:

| Function | Purpose |
|----------|---------|
| `withTimeout(promise, ms)` | Wraps query with 5-10s timeout |
| `safeCount(fn, label)` | Count with error catching + validation |
| `safeAggregate(fn, field, label)` | Aggregate with error catching |
| `safeFindMany(fn, label)` | FindMany with error catching |
| `checkDbHealth()` | Quick `SELECT 1` health check |
| `validateStat(label, displayed, actual)` | Cross-checks cached vs live data |

**Principle:** "Never crash, never hang, never show wrong data."

## Information Architecture (3-Layer)

```
Layer 1: Executive (Dashboard)
  └── DailyStats pre-computed KPIs (instant load)

Layer 2: Managerial (Section Pages)
  └── Overview tab with aggregate counts

Layer 3: Operational (Detail Pages)
  └── Paginated lists with search + filter
```

## Caching Strategy

| Cache Layer | TTL | Purpose |
|-------------|-----|---------|
| DailyStats table | 24h (recomputed by cron) | Dashboard KPIs |
| CreditScoreCache table | 24h (recomputed on demand) | Credit scores |
| UserSegmentCache table | 24h (recomputed by cron) | User segments |
| React Query (browser) | 30-60s | Page data |
| HTTP Cache-Control | 60s | Public status page |

## Background Jobs (Production)

These should run via Vercel Cron or external scheduler:

| Job | Frequency | Purpose |
|-----|-----------|---------|
| `compute-daily-stats` | Daily 2 AM | Pre-compute dashboard KPIs |
| `compute-segments` | Daily 3 AM | Pre-compute user segments |
| `compute-credit-scores` | Daily 4 AM | Pre-compute credit scores |
| `detect-anomalies` | Daily 5 AM | Check for metric spikes/drops |
| `evaluate-fraud-rules` | Every 15 min | Check fraud rules against data |
| `campaign-step-executor` | Every 5 min | Send scheduled campaign steps |

## File Structure (Admin Repo)

```
bahikhata-admin/
├── prisma/
│   └── schema.prisma              # Database schema (shared with main app)
├── docs/
│   └── how-to-test/               # Testing guides (this folder)
├── src/
│   ├── app/
│   │   ├── (admin)/               # Admin pages (auth required)
│   │   │   ├── page.tsx           # Dashboard
│   │   │   ├── users/
│   │   │   ├── revenue/
│   │   │   ├── segments/
│   │   │   ├── ai-usage/
│   │   │   ├── data/              # Data Monetization
│   │   │   ├── risk/
│   │   │   ├── subscriptions/
│   │   │   ├── support/
│   │   │   ├── feedback/
│   │   │   ├── activity/
│   │   │   ├── features/
│   │   │   ├── settings/
│   │   │   ├── audit-log/
│   │   │   ├── notification-templates/
│   │   │   ├── notifications/
│   │   │   ├── campaigns/
│   │   │   ├── incidents/
│   │   │   ├── anomalies/
│   │   │   └── fraud-rules/
│   │   ├── status/                # Public status page (NO auth)
│   │   ├── login/                 # Login page (NO auth)
│   │   └── api/
│   │       ├── admin/             # Admin API routes (auth required)
│   │       │   ├── overview/
│   │       │   ├── users/
│   │       │   ├── notifications/
│   │       │   ├── campaigns/
│   │       │   ├── incidents/
│   │       │   ├── anomalies/
│   │       │   ├── fraud-rules/
│   │       │   └── ...
│   │       ├── status/            # Public status API (NO auth)
│   │       └── auth/              # NextAuth routes
│   ├── components/
│   │   ├── admin/
│   │   │   ├── ui.tsx             # Design system components
│   │   │   ├── admin-sidebar.tsx  # Navigation sidebar
│   │   │   └── global-error-boundary.tsx
│   │   └── providers.tsx          # React Query + NextAuth providers
│   ├── lib/
│   │   ├── db.ts                  # Prisma client
│   │   ├── auth.ts                # NextAuth config
│   │   ├── resilience.ts          # Timeout + error catching
│   │   ├── audit.ts               # AdminAction logging
│   │   ├── segments.ts            # User segment computation
│   │   ├── credit-score.ts        # Credit scoring algorithm
│   │   ├── health-score.ts        # Customer health scoring
│   │   ├── notification-providers.ts  # SMS/Email/Push providers
│   │   ├── anomaly-detection.ts   # Z-score anomaly detection
│   │   └── fraud-rules-engine.ts  # Fraud rule evaluation
│   └── middleware.ts              # Auth + CSRF + security headers
├── .env.example                   # Environment variable template
├── package.json
└── next.config.ts
```
