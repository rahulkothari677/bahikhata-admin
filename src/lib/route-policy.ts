/**
 * THE ROUTE POLICY REGISTER — the admin panel's architectural backbone.
 *
 * Every API route declares, in one place: who may call it, WHY it exists, what
 * class of personal data it touches, and whether it should exist at all.
 *
 * WHY THIS FILE EXISTS (audit 2026-07-26)
 * ───────────────────────────────────────
 * Authorisation used to live in a hardcoded list of URL prefixes in
 * middleware.ts. Two of those prefixes pointed at routes that had been renamed
 * or never existed ('/api/admin/coupons', '/api/admin/feature-flags'), so the
 * guard silently matched nothing and a read-only "viewer" could flip the global
 * feature kill-switches for the entire shopkeeper app. A list of strings that
 * has to be kept in sync with the filesystem by hand will always drift.
 *
 * This register cannot drift: a CI test walks src/app/api/**\/route.ts and
 * fails the build if any route is missing an entry, or declares a method it
 * does not export.
 *
 * IT IS ALSO THE COMPLIANCE ARTEFACT
 * ──────────────────────────────────
 * DPDP requires a Data Fiduciary to know its purposes for processing. Under
 * Significant Data Fiduciary obligations that becomes a documented processing
 * register with DPIAs. Rather than maintain a spreadsheet that goes stale the
 * week it is written, the register is generated FROM THE CODE — `purpose` and
 * `pii` below are the register. If a route cannot state a purpose in one
 * sentence, that is the signal it should not exist.
 *
 * HOW TO ADD A ROUTE
 * ──────────────────
 *   1. Add the entry here first. CI fails until you do.
 *   2. Wrap the handler in withAdmin() so the policy is actually enforced.
 *   3. If you cannot write a `purpose`, do not build the route.
 */

/**
 * Roles are NOT a linear hierarchy. A finance operator should see revenue but
 * never a shopkeeper's ledger; a support agent needs the opposite. Modelling
 * them as ranks (viewer < admin < founder) is what forced over-granting in the
 * original three-role design — the only way to let support do its job was to
 * hand it everything below founder.
 *
 * `founder` is implicitly permitted everywhere and is never listed.
 */
export type AdminRole = 'viewer' | 'support' | 'analyst' | 'finance' | 'founder'

/**
 * What class of data crosses the wire. Drives masking, audit depth and
 * retention — not merely documentation.
 *
 *  none        — no personal data at all (system config, health)
 *  aggregate   — counts and sums only; no row is attributable to a person
 *  identifiers — EkBook's own customer identity (name, email, phone, GSTIN)
 *  financial   — EkBook's commercial relationship (subscriptions, payments)
 *  third-party — 🔴 the shopkeeper's LEDGER. Contains data about THEIR
 *                customers and suppliers: people with no relationship to
 *                EkBook who consented to nothing. The most restricted class in
 *                the system. Access must be purpose-bound, ticket-linked,
 *                time-boxed and visible to the shopkeeper.
 */
export type PiiClass =
  | 'none'
  | 'aggregate'
  | 'identifiers'
  | 'financial'
  | 'third-party'

/**
 *  keep      — sound as designed
 *  constrain — legitimate, but needs a stated purpose, masking or gating
 *  remove    — no lawful basis; must be deleted, with the reason recorded
 */
export type Verdict = 'keep' | 'constrain' | 'remove'

export interface RoutePolicy {
  GET?: AdminRole[]
  POST?: AdminRole[]
  PUT?: AdminRole[]
  PATCH?: AdminRole[]
  DELETE?: AdminRole[]
  /** Callable with CRON_SECRET instead of a session. */
  cron?: boolean
  /** Reachable with no session at all. Must be justified in `note`. */
  public?: boolean
  /** Why this route exists, in one sentence. If you cannot write it, delete the route. */
  purpose: string
  pii: PiiClass
  /** DPDP basis or the statute that compels it. */
  lawfulBasis: string
  verdict: Verdict
  /** Requires a fresh TOTP even inside a valid session. */
  stepUp?: boolean
  /**
   * The route only ever acts on the CALLING operator's own record — never on
   * another user's data. Managing your own second factor is the archetype: a
   * viewer must be able to do it, or mandatory 2FA locks them out permanently.
   *
   * This is the ONLY sanctioned reason a `viewer` may perform a mutation, and
   * the route handler is responsible for scoping every write to ctx.adminId.
   */
  selfScoped?: boolean
  note?: string
}

const CONTRACT = 'Contract performance (DPDP s.7(a)) — operating the service the user signed up for'
const LEGIT_OPS = 'Legitimate use — operating and securing the service'
const LEGAL_DUTY = 'Legal obligation — DPDP Rule 6 access logs (1 yr) / CERT-In ICT logs (180 days, in India)'
const OWN_COMMERCIAL = "EkBook's own commercial records — the subscriber relationship, not the shopkeeper's books"
const CONSENT_PROMO = 'Consent (DPDP s.6) — double opt-in required for promotional messages; TRAI TCCCPR applies'
const DSR = 'Data Principal rights (DPDP ss.11-13) — access, correction, erasure, grievance'

export const ROUTE_POLICY: Record<string, RoutePolicy> = {
  // ─── Auth & admin identity ────────────────────────────────────────────
  'auth/[...nextauth]': {
    public: true,
    purpose: 'Authenticate admin operators',
    pii: 'identifiers',
    lawfulBasis: LEGIT_OPS,
    verdict: 'keep',
    note: 'Public by necessity — it IS the login.',
  },
  'admin/setup': {
    POST: [], public: true,
    purpose: 'One-time bootstrap of the first founder account',
    pii: 'identifiers',
    lawfulBasis: LEGIT_OPS,
    verdict: 'constrain',
    note: 'GET removed — it answered {adminCount} to the open internet, telling any scanner when the bootstrap window was open. POST needs SETUP_SECRET.',
  },
  'admin/forgot-password': {
    POST: [], PATCH: [], public: true,
    purpose: 'Admin password recovery',
    pii: 'identifiers',
    lawfulBasis: LEGIT_OPS,
    verdict: 'constrain',
    note: 'Email delivery is NOT wired and /reset-password does not exist. Must 501 until both are real rather than returning a fake success.',
  },
  'admin/login-probe': {
    POST: [], public: true,
    purpose: 'Distinguish "needs 2FA" from "wrong password" after NextAuth flattens the error',
    pii: 'identifiers',
    lawfulBasis: LEGIT_OPS,
    verdict: 'constrain',
    note: 'Only reveals 2FA state AFTER the password is verified, so not an enumeration oracle. But it double-consumes the rate limit: one UI login burns 2 of 5 slots.',
  },
  'admin/backup-log': {
    GET: ['finance'], POST: [], cron: true,
    purpose: 'Record and prove daily India-resident backups (Income-tax Rule 46(8))',
    pii: 'none',
    lawfulBasis: LEGAL_DUTY,
    verdict: 'keep',
    note: 'Running the backup is half the obligation; proving the daily cadence is the other half. GET reports days-since-last-success so a job that silently stopped is visible.',
  },
  'admin/retention/review': {
    GET: [],
    purpose: 'Report closed accounts whose statutory retention period has expired',
    pii: 'identifiers',
    lawfulBasis: LEGAL_DUTY,
    verdict: 'keep',
    note: 'REPORTS ONLY — deletes nothing, and the admin DB role has DELETE revoked. An unattended purge job is the most dangerous code that could exist here; a date bug destroys books that are still legally required, with no undo.',
  },
  'admin/break-glass': {
    // Founder-only. Listing no other role is how this file expresses that:
    // `founder` is implicitly permitted everywhere and never appears in a list.
    GET: [],
    POST: [],
    purpose: 'Open and review time-boxed emergency access when the normal controls lock an operator out',
    pii: 'none',
    lawfulBasis: LEGIT_OPS,
    verdict: 'keep',
    note:
      'Must NOT require stepUp: break-glass verifies a fresh TOTP inside the handler itself, and requiring ' +
      'step-up as well would make it unusable in the exact situation it exists for. The 60-minute ceiling, ' +
      'mandatory written reason and single-active-session rule are enforced in src/lib/break-glass.ts.',
  },
  'admin/break-glass/revoke': {
    GET: [],
    POST: [],
    purpose: 'Close an active emergency-access session early',
    pii: 'none',
    lawfulBasis: LEGIT_OPS,
    verdict: 'keep',
    note:
      'Deliberately the lowest-friction operation here — no TOTP, no reason. Making it harder than activation ' +
      'would leave emergency windows open out of inconvenience. Any founder may revoke, not only the opener: ' +
      'if a session was opened by a compromised account, whoever shuts it down is by definition not that account.',
  },
  'admin/step-up': {
    GET: ['viewer', 'support', 'analyst', 'finance'],
    POST: ['viewer', 'support', 'analyst', 'finance'],
    selfScoped: true,
    purpose: 'Re-prove possession of the second factor before a sensitive action',
    pii: 'none',
    lawfulBasis: LEGIT_OPS,
    verdict: 'keep',
    note: 'Must NOT itself require stepUp — that would be unsatisfiable. Self-scoped: it only ever acts on the calling operator.',
  },
  'admin/2fa': {
    GET: ['viewer', 'support', 'analyst', 'finance'],
    POST: ['viewer', 'support', 'analyst', 'finance'],
    DELETE: ['viewer', 'support', 'analyst', 'finance'],
    selfScoped: true,
    purpose: 'Operator manages their own second factor',
    pii: 'identifiers',
    lawfulBasis: LEGIT_OPS,
    verdict: 'constrain',
    note: 'Self-scoped only. Needs a rate limit — TOTP verification currently accepts unlimited guesses.',
  },
  'admin/admin-users': {
    GET: [], POST: [], stepUp: true,
    purpose: 'Manage who has admin access',
    pii: 'identifiers',
    lawfulBasis: LEGIT_OPS,
    verdict: 'keep',
  },
  'admin/admin-users/[id]': {
    PATCH: [], DELETE: [], stepUp: true,
    purpose: 'Change or revoke an operator\'s access',
    pii: 'identifiers',
    lawfulBasis: LEGIT_OPS,
    verdict: 'keep',
    note: 'Must bump tokenVersion — today a demoted admin keeps founder powers until their 1-hour JWT expires.',
  },

  // ─── Users & support ──────────────────────────────────────────────────
  'admin/users': {
    GET: ['support', 'analyst', 'finance'],
    purpose: 'Find a shopkeeper account to support or bill',
    pii: 'identifiers',
    lawfulBasis: CONTRACT,
    verdict: 'constrain',
    note: 'Identifiers MASKED by default. Keyset pagination; drop the per-row _count and the unfiltered count.',
  },
  'admin/users/[id]': {
    GET: ['support', 'finance'], PATCH: ['support', 'finance'], stepUp: true,
    purpose: 'Resolve a support ticket or correct a billing error for one named account',
    pii: 'third-party',
    lawfulBasis: CONTRACT,
    verdict: 'constrain',
    note: '🔴 Returns the shopkeeper\'s recent TRANSACTIONS — third-party data. Must require a linked ticket and be visible to the shopkeeper.',
  },
  'admin/support': {
    GET: ['support'], POST: ['support'],
    purpose: 'Handle support requests, and serve as the DPDP grievance channel',
    pii: 'identifiers',
    lawfulBasis: DSR,
    verdict: 'keep',
  },
  'admin/support/[id]': {
    PATCH: ['support'],
    purpose: 'Update a support ticket',
    pii: 'identifiers',
    lawfulBasis: DSR,
    verdict: 'keep',
  },
  'admin/activity': {
    GET: ['support', 'analyst'],
    purpose: 'Operational awareness of system-wide event volume',
    pii: 'aggregate',
    lawfulBasis: LEGIT_OPS,
    verdict: 'constrain',
    note: '⛔ Per-transaction feed REMOVED 2026-07-26 — it streamed shopkeepers\' sales by name and email. Counts remain; identifiers masked.',
  },
  'admin/impersonate': {
    POST: [], stepUp: true,
    purpose: 'Reproduce a bug in a shopkeeper\'s own session to resolve their ticket',
    pii: 'third-party',
    lawfulBasis: CONTRACT,
    verdict: 'constrain',
    note: 'Token mechanics are sound. Missing: linked ticket, and the shopkeeper is never told it happened.',
  },
  'admin/impersonation-log': {
    GET: [],
    purpose: 'Record of every impersonation, for the operator and the shopkeeper',
    pii: 'identifiers',
    lawfulBasis: LEGAL_DUTY,
    verdict: 'keep',
  },

  // ─── Money (EkBook's own commercial records) ──────────────────────────
  'admin/revenue': { GET: ['finance', 'analyst'], purpose: 'Track EkBook subscription revenue', pii: 'financial', lawfulBasis: OWN_COMMERCIAL, verdict: 'keep' },
  'admin/revenue-recognition': { GET: ['finance'], purpose: 'Accrual revenue schedule for accounting', pii: 'financial', lawfulBasis: OWN_COMMERCIAL, verdict: 'keep' },
  'admin/revenue-recognition/recompute': { POST: ['finance'], GET: ['finance'], cron: true, purpose: 'Rebuild the revenue recognition schedule', pii: 'financial', lawfulBasis: OWN_COMMERCIAL, verdict: 'keep', note: 'Was never scheduled — the P&L showed Rs.0 revenue indefinitely. Now daily.' },
  'admin/subscriptions': { GET: ['finance', 'analyst'], purpose: 'Manage subscriber billing', pii: 'financial', lawfulBasis: OWN_COMMERCIAL, verdict: 'keep' },
  'admin/financial-reports': { GET: ['finance'], purpose: 'P&L and financial statements for EkBook itself', pii: 'financial', lawfulBasis: OWN_COMMERCIAL, verdict: 'keep' },
  'admin/growth': { GET: ['analyst', 'finance'], purpose: 'Growth and cohort metrics', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/overview': { GET: ['viewer', 'support', 'analyst', 'finance'], purpose: 'Founder dashboard — headline aggregates', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Recent-events list still carries identifiers; must use the same masking as activity.' },
  'admin/ai-usage': { GET: ['analyst', 'finance'], purpose: 'Track AI provider cost, EkBook\'s largest variable cost', pii: 'aggregate', lawfulBasis: OWN_COMMERCIAL, verdict: 'keep' },

  // ─── Profiling — legitimate, but must be disclosed ────────────────────
  'admin/churn-predictions': { GET: ['analyst', 'finance'], purpose: 'Identify subscribers at risk of cancelling so they can be helped', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Profiling. Must appear in the privacy notice. No adverse action without human review.' },
  'admin/churn-predictions/compute': { POST: ['analyst'], cron: true, purpose: 'Recompute churn scores', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/segments': { GET: ['analyst'], purpose: 'Group users for product and lifecycle decisions', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/campaigns': { GET: ['analyst'], POST: ['analyst'], purpose: 'Plan lifecycle communications', pii: 'identifiers', lawfulBasis: 'Consent (promotional) / contract (service messages)', verdict: 'constrain', note: 'TRAI TCCCPR: DLT template + 10:00-21:00 IST window for promotional SMS.' },
  'admin/campaigns/[id]': { GET: ['analyst'], PATCH: ['analyst'], DELETE: ['analyst'], purpose: 'Edit a campaign', pii: 'identifiers', lawfulBasis: CONSENT_PROMO, verdict: 'constrain' },
  'admin/campaigns/[id]/action': { POST: ['analyst'], purpose: 'Send or schedule a campaign', pii: 'identifiers', lawfulBasis: CONSENT_PROMO, verdict: 'constrain', note: 'Must refuse promotional sends without a DLT template id.' },
  'admin/campaigns/segments': { GET: ['analyst'], purpose: 'Resolve a campaign audience', pii: 'aggregate', lawfulBasis: CONSENT_PROMO, verdict: 'constrain' },
  'admin/nps': { GET: ['analyst', 'support'], purpose: 'Read satisfaction feedback users chose to give', pii: 'identifiers', lawfulBasis: CONTRACT, verdict: 'keep' },
  'admin/nps-config': { GET: ['analyst'], POST: ['analyst'], purpose: 'Configure the NPS survey', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/nps-config/[id]': { PATCH: ['analyst'], DELETE: ['analyst'], purpose: 'Edit an NPS survey', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/experiments': { GET: ['analyst'], POST: ['analyst'], purpose: 'Run product A/B tests', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/experiments/[id]': { GET: ['analyst'], PATCH: ['analyst'], DELETE: ['analyst'], purpose: 'Edit an experiment', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/competitors': { GET: ['analyst'], POST: ['analyst'], purpose: 'Track competitor pricing — no user data involved', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/competitors/[id]': { GET: ['analyst'], PATCH: ['analyst'], DELETE: ['analyst'], purpose: 'Edit a competitor record', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },

  // ─── Risk & integrity ─────────────────────────────────────────────────
  'admin/risk': { GET: ['analyst'], purpose: 'Detect fraud and platform abuse', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: '🔴 Reads raw Transaction rows. Must expose SCORES, with drill-down only from a confirmed alert.' },
  'admin/fraud-alerts': { GET: ['analyst', 'support'], purpose: 'Review suspected fraud', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/fraud-alerts/[id]': { PATCH: ['analyst'], purpose: 'Triage a fraud alert', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Dismissal must be attributable — a viewer could clear alerts silently.' },
  'admin/fraud-rules': { GET: ['analyst'], POST: ['analyst'], purpose: 'Define fraud detection rules', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/fraud-rules/[id]': { PATCH: ['analyst'], DELETE: ['analyst'], purpose: 'Edit a fraud rule', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/fraud-rules/evaluate': { POST: ['analyst'], GET: ['analyst'], cron: true, purpose: 'Evaluate fraud rules on a schedule', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/anomalies': { GET: ['analyst'], purpose: 'Detect abnormal platform metrics', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/anomalies/[id]': { PATCH: ['analyst'], purpose: 'Acknowledge an anomaly', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/anomalies/detect': { POST: ['analyst'], GET: ['analyst'], cron: true, purpose: 'Run anomaly detection', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/incidents': { GET: ['viewer', 'support', 'analyst', 'finance'], POST: ['support'], purpose: 'Track outages and the DPDP/CERT-In breach clocks', pii: 'none', lawfulBasis: LEGAL_DUTY, verdict: 'constrain', note: 'Should drive the 6-hour CERT-In and 72-hour DPDP timers.' },
  'admin/incidents/[id]': { GET: ['viewer', 'support', 'analyst', 'finance'], PATCH: ['support'], DELETE: [], purpose: 'Update an incident', pii: 'none', lawfulBasis: LEGAL_DUTY, verdict: 'keep' },
  'admin/incidents/[id]/updates': { POST: ['support'], purpose: 'Post an incident update', pii: 'none', lawfulBasis: LEGAL_DUTY, verdict: 'keep' },
  'admin/validate-data': { GET: ['analyst'], purpose: 'Check data integrity across the shared database', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Must run on the read replica — it competes with shopkeeper traffic today.' },
  'admin/health': { GET: ['viewer', 'support', 'analyst', 'finance'], purpose: 'Internal health check', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Currently near-static; should check DB, replica lag, Redis, last rollup and last India backup.' },

  // ─── Ops ──────────────────────────────────────────────────────────────
  'admin/compute-daily-stats': { POST: ['analyst'], GET: ['analyst'], cron: true, purpose: 'Precompute daily aggregates so dashboards never scan raw tables', pii: 'aggregate', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/bulk': { POST: [], stepUp: true, purpose: 'Queue a bulk operation across many accounts', pii: 'identifiers', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/bulk-jobs': { GET: [], POST: [], purpose: 'Manage long-running jobs', pii: 'identifiers', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/bulk-jobs/[id]': { PATCH: [], DELETE: [], purpose: 'Control a single job', pii: 'identifiers', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/bulk-jobs/execute': { POST: [], cron: true, purpose: 'Run queued jobs', pii: 'identifiers', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Job claiming must be atomic (conditional update + count), not read-then-write.' },
  'admin/notifications': { POST: ['support'], GET: ['support'], DELETE: ['support'], purpose: 'Send service messages to users', pii: 'identifiers', lawfulBasis: CONTRACT, verdict: 'constrain' },
  'admin/notifications/send': { POST: ['support'], purpose: 'Dispatch a notification', pii: 'identifiers', lawfulBasis: CONTRACT, verdict: 'constrain', note: 'TRAI: DLT template required for SMS; promotional restricted to 10:00-21:00 IST.' },
  'admin/notifications/log': { GET: ['support'], purpose: 'Delivery history', pii: 'identifiers', lawfulBasis: LEGAL_DUTY, verdict: 'keep' },
  'admin/notifications/status': { GET: ['support'], purpose: 'Provider health', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/notifications/templates': { GET: ['support'], purpose: 'List message templates', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/notification-templates': { GET: ['support'], POST: ['support'], purpose: 'Manage message templates', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Needs channel, category and dltTemplateId fields.' },
  'admin/notification-templates/[id]': { GET: ['support'], PATCH: ['support'], DELETE: ['support'], purpose: 'Edit a template', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/webhooks': { GET: [], POST: [], purpose: 'Configure outbound integrations', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Never place user PII in a webhook body. Verify the SSRF denylist covers DNS rebinding and redirects.' },
  'admin/webhooks/[id]': { PATCH: [], DELETE: [], purpose: 'Edit a webhook endpoint', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/webhooks/deliver': { POST: [], cron: true, purpose: 'Deliver queued webhooks', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },
  'admin/webhooks/deliveries': { GET: [], purpose: 'Webhook delivery history', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/features': { GET: ['viewer', 'support', 'analyst', 'finance'], purpose: 'Read feature flag state', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/features/[key]': { PATCH: [], POST: [], purpose: 'Toggle a global kill-switch for the shopkeeper app', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: '🔴 THE ESCALATION BUG. Middleware guarded "/api/admin/feature-flags"; the real path is "/api/admin/features". A viewer could flip any kill-switch.' },
  'admin/api-keys': { GET: [], POST: [], stepUp: true, purpose: 'Manage partner API credentials', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Store hash only, scope per key, add expiry and rotation.' },
  'admin/api-keys/[id]': { GET: [], PATCH: [], DELETE: [], stepUp: true, purpose: 'Manage one API key', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'constrain' },

  // ─── Data & compliance ────────────────────────────────────────────────
  'admin/audit-log': { GET: [], purpose: 'Tamper-evident record of every admin action', pii: 'identifiers', lawfulBasis: LEGAL_DUTY, verdict: 'constrain', note: 'Needs hash chaining, append-only DB grants, and a viewer UI.' },
  // 🔒 2026-08-04 (Phase 7 audit): verifyAuditChain() existed, was correct and
  // well-tested, and had ZERO callers — no route, no workflow. The chain that
  // makes the log above "tamper-evident" was never once inspected. Read-only,
  // and runs nightly; `cron: true` lets the scheduled job authenticate.
  'admin/audit-chain/verify': { GET: [], cron: true, purpose: 'Detect tampering in the admin audit chain', pii: 'none', lawfulBasis: LEGAL_DUTY, verdict: 'keep', note: 'Read-only by design — a verifier that can write to what it verifies proves nothing.' },
  'admin/data-exports': { GET: [], POST: [], stepUp: true, purpose: 'Serve DPDP access requests and authorised bulk exports', pii: 'third-party', lawfulBasis: DSR, verdict: 'constrain' },
  'admin/data-exports/[id]': { DELETE: [], purpose: 'Delete a generated export file', pii: 'third-party', lawfulBasis: DSR, verdict: 'keep' },
  'admin/data-exports/generate': { POST: [], stepUp: true, purpose: 'Produce the export payload', pii: 'third-party', lawfulBasis: DSR, verdict: 'constrain', note: '🔴 Silently caps at 1,000 transactions while hardcoding truncated:false. A DPDP access request must be COMPLETE — this is a legal defect, not just a scale one. Also buffers the whole file in memory.' },
  'admin/database': { GET: [], purpose: 'Inspect database size and table statistics', pii: 'none', lawfulBasis: LEGIT_OPS, verdict: 'keep' },
  'admin/database/query': { POST: [], stepUp: true, purpose: 'Read-only SQL for incident investigation', pii: 'third-party', lawfulBasis: LEGIT_OPS, verdict: 'keep', note: 'AUDITED AND SOUND — fails closed without READONLY_DATABASE_URL, SELECT/WITH only, keyword-blocked, statement timeout, audit-logged. Do not modify.' },
  'admin/database/export': { POST: [], stepUp: true, purpose: 'Export query results', pii: 'third-party', lawfulBasis: LEGIT_OPS, verdict: 'constrain', note: 'Must stream, not buffer.' },
  'admin/gst-filing': { GET: ['finance'], purpose: 'Compute GST figures from data the user already owns', pii: 'third-party', lawfulBasis: CONTRACT, verdict: 'constrain', note: 'Computation only. Transmission to GSTN requires a licensed GSP — never store portal credentials.' },

}

/**
 * WITHDRAWN CAPABILITIES — the permanent record of what was removed and why.
 *
 * These are NOT in ROUTE_POLICY because their route files no longer exist, and
 * the CI guard fails on any policy entry naming a route that is absent. But the
 * reasoning must outlive the code: without it, a future contributor sees a gap
 * in the product and helpfully rebuilds the thing a regulator would fine you for.
 *
 * A test asserts this record stays non-empty and that none of these paths comes
 * back as a live route.
 */
export const WITHDRAWN_CAPABILITIES: Record<
  string,
  { removedOn: string; reason: string; rebuildableIf?: string }
> = {
  'admin/account-aggregator': {
    removedOn: '2026-07-26',
    reason:
      'EkBook cannot lawfully be an Account Aggregator Financial Information User. ' +
      'Under the RBI AA framework an FIU must itself be regulated by RBI, SEBI, IRDAI or PFRDA. ' +
      'EkBook is a bookkeeping SaaS and is not eligible for that designation. ' +
      'The implementation also inverted consent: an ADMIN initiated the consent request on ' +
      "the user's behalf, whereas the framework requires the customer to grant consent inside " +
      "the Account Aggregator's own application. Consent obtained the way this code obtained " +
      'it would not be valid consent under either the AA Master Directions or DPDP s.6.',
    rebuildableIf:
      'EkBook obtains an RBI/SEBI/IRDAI/PFRDA registration that makes it FIU-eligible, AND the ' +
      'consent journey moves into a licensed AA app. Until both hold, do not rebuild this.',
  },
  'admin/supplier-intelligence': {
    removedOn: '2026-07-26',
    reason:
      "Aggregating shopkeepers' purchase records into a saleable supplier product is a NEW " +
      'PURPOSE, not covered by the consent given for bookkeeping. DPDP s.6 requires consent to ' +
      'be for a specified purpose, so the existing consent cannot carry it. It also processes ' +
      "SUPPLIERS' data — third parties with no relationship to EkBook who consented to nothing " +
      'and have no way to object.',
    rebuildableIf:
      'It becomes explicit opt-in with its own notice, genuinely aggregate (k-anonymity >= 5 so ' +
      'no individual shop or supplier is identifiable), and disclosed in the privacy policy ' +
      'before any data is collected for it.',
  },
}

/** Public, unauthenticated routes. Kept separate so they are impossible to add by accident. */
export const PUBLIC_ROUTES = ['status'] as const

export const ALL_ROLES: AdminRole[] = ['viewer', 'support', 'analyst', 'finance', 'founder']

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/**
 * Is `role` permitted to call `method` on `routeKey`?
 * `founder` is permitted everywhere and is never listed in the policy.
 * An empty array means founder-only.
 */
export function isRoleAllowed(
  policy: RoutePolicy,
  method: HttpMethod,
  role: AdminRole | undefined,
): boolean {
  if (!role) return false
  if (role === 'founder') return true
  const allowed = policy[method]
  if (allowed === undefined) return false // method not declared => denied
  return allowed.includes(role)
}

/**
 * The DPDP processing register, derived from code rather than maintained by hand.
 * Feeds the SDF documentation obligations if EkBook is ever designated.
 */
export function buildProcessingRegister() {
  return Object.entries(ROUTE_POLICY).map(([route, p]) => ({
    route,
    purpose: p.purpose,
    dataClass: p.pii,
    lawfulBasis: p.lawfulBasis,
    verdict: p.verdict,
    methods: HTTP_METHODS.filter((m) => p[m] !== undefined),
  }))
}
