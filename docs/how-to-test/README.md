# How to Test — BahiKhata Pro Admin Panel

This folder contains step-by-step testing guides for every feature in the admin panel.
Each guide tells you exactly what to click, what to expect, and how to verify the feature works.

## Quick Navigation

### Phase 1.5 — Scalability Fixes
| Feature | Guide | Page URL |
|---------|-------|----------|
| Credit Scoring (Data Monetization) | [phase-1.5-credit-scoring.md](./phase-1.5-credit-scoring.md) | `/data` |

### Phase 1.6 — Page Redesigns (Design System + Scalability)
| Feature | Guide | Page URL |
|---------|-------|----------|
| AI Usage & Cost | [phase-1.6-ai-usage.md](./phase-1.6-ai-usage.md) | `/ai-usage` |
| Risk & Compliance | [phase-1.6-risk-compliance.md](./phase-1.6-risk-compliance.md) | `/risk` |
| Subscriptions | [phase-1.6-subscriptions.md](./phase-1.6-subscriptions.md) | `/subscriptions` |
| Support Tickets | [phase-1.6-support.md](./phase-1.6-support.md) | `/support` |
| Feedback (NPS) | [phase-1.6-feedback.md](./phase-1.6-feedback.md) | `/feedback` |

### Phase 2 — New Features
| # | Feature | Guide | Page URL |
|---|---------|-------|----------|
| 1 | Notification Templates | [phase-2.1-notification-templates.md](./phase-2.1-notification-templates.md) | `/notification-templates` |
| 2 | Multi-channel Notifications | [phase-2.2-multi-channel-notifications.md](./phase-2.2-multi-channel-notifications.md) | `/notifications` |
| 3 | Campaign Management | [phase-2.3-campaign-management.md](./phase-2.3-campaign-management.md) | `/campaigns` |
| 4 | Status Page | [phase-2.4-status-page.md](./phase-2.4-status-page.md) | `/incidents` + `/status` |
| 5 | Anomaly Detection | [phase-2.5-anomaly-detection.md](./phase-2.5-anomaly-detection.md) | `/anomalies` |
| 6 | Configurable Fraud Rules | [phase-2.6-configurable-fraud-rules.md](./phase-2.6-configurable-fraud-rules.md) | `/fraud-rules` |
| 7 | Partner Management | [phase-2.7-partner-management.md](./phase-2.7-partner-management.md) | `/partners` |
| 8 | API Key Management | [phase-2.8-api-key-management.md](./phase-2.8-api-key-management.md) | `/api-keys` |
| 9 | Webhook Management | [phase-2.9-webhook-management.md](./phase-2.9-webhook-management.md) | `/webhooks` |
| 10 | Revenue Recognition | [phase-2.10-revenue-recognition.md](./phase-2.10-revenue-recognition.md) | `/revenue-recognition` |
| 11 | Financial Reports | [phase-2.11-financial-reports.md](./phase-2.11-financial-reports.md) | `/financial-reports` |
| 12 | A/B Testing | [phase-2.12-ab-testing.md](./phase-2.12-ab-testing.md) | `/experiments` |
| 13 | Database Admin Tools | [phase-2.13-database-admin.md](./phase-2.13-database-admin.md) | `/database` |
| 14 | Competitor Monitoring | [phase-2.14-competitor-monitoring.md](./phase-2.14-competitor-monitoring.md) | `/competitors` |
| 15 | Audit Log Explorer | [phase-2.15-audit-log-explorer.md](./phase-2.15-audit-log-explorer.md) | `/audit-log` |
| 16 | Bulk Operations v2 | [phase-2.16-bulk-operations.md](./phase-2.16-bulk-operations.md) | `/bulk-jobs` |
| 17 | Feature Flag Analytics | [phase-2.17-feature-flag-analytics.md](./phase-2.17-feature-flag-analytics.md) | `/features` |
| 18 | Segment-to-Campaign | [phase-2.18-segment-to-campaign.md](./phase-2.18-segment-to-campaign.md) | `/campaigns` + `/segments` |

---

## Foundational Reference Docs

These docs explain the architecture, setup, and principles behind the admin panel:

| Doc | Description |
|-----|-------------|
| [architecture-overview.md](./architecture-overview.md) | Two-repo structure, tech stack, design system, file structure |
| [environment-variables.md](./environment-variables.md) | All env vars for admin + main app (with examples) |
| [deployment-guide.md](./deployment-guide.md) | Step-by-step Vercel deployment + database setup + troubleshooting |
| [scalability-principles.md](./scalability-principles.md) | The 13-point checklist every feature must satisfy |

---

## How to Use These Guides

1. **Find the feature** you want to test in the table above
2. **Click the guide link** to open the markdown file
3. **Follow the steps** in order — each step has:
   - What to do (click, type, etc.)
   - What you should see (expected result)
   - How to verify it worked

## Prerequisites

- Admin panel deployed and accessible (e.g. `https://admin.bahikhata.pro`)
- Admin account created (founder email must be in `FOUNDER_EMAILS` env var)
- Database migrated (run `prisma db push` after schema changes)
- Hard refresh browser after each deploy (`Ctrl+Shift+R` or `Cmd+Shift+R`)

## Common Issues

| Issue | Solution |
|-------|----------|
| Page shows white screen | Hard refresh (`Ctrl+Shift+R`) — clears cached CSS/JS |
| Modal appears dark/unreadable | Fixed in Phase 2.1 — if still happening, check `chrome://flags/#enable-force-dark` is disabled |
| 401 Unauthorized | Session expired — login again at `/login` |
| 500 Server Error | Check Vercel function logs — likely DB connection issue |
| Data not updating | Wait 60s (React Query cache) or click refresh button |

## Scalability Checklist (applies to all features)

Every feature in this admin panel satisfies these 13 principles:

1. ✅ No unbounded data → pagination
2. ✅ No N+1 queries → bulk aggregate
3. ✅ No compute on page load → pre-compute + cache
4. ✅ No loading all rows in memory → cursor pagination
5. ✅ No frequent polling → webhooks or higher interval
6. ✅ No blocking requests → background job
7. ✅ Search + filter + pagination on every list
8. ✅ Cognitive load: can a human understand this at 1M+ users?
9. ✅ Every query has 5-10s timeout (never hang)
10. ✅ Every query catches errors → safe defaults (never crash)
11. ✅ Every page wrapped in GlobalErrorBoundary (never white screen)
12. ✅ Every KPI cross-checkable against live DB (investor trust)
13. ✅ Every result validated (no NaN/Infinity/negatives)

---

**Last updated:** Phase 2 (18/22) — Segment-to-Campaign
**Total features documented:** 24 (23 feature guides + 4 foundational reference docs)
