/**
 * Founder email whitelist — only these emails can access the admin panel.
 *
 * To add a new admin: add their email here, deploy, then they can create
 * their account at /login.
 *
 * For production, set the FOUNDER_EMAILS env var (comma-separated).
 * This file is the fallback for development.
 */

/**
 * Development-only fallback. NEVER used in production — see below.
 *
 * 🔒 (audit 2026-07-27) This list used to contain a real founder address and
 * was returned whenever FOUNDER_EMAILS was unset, INCLUDING in production.
 * Combined with POST /api/admin/setup — which mints a founder account whenever
 * the AdminUser table is empty — that meant: if the env var was ever missing
 * or misspelled after a restore, a migration accident, or a table being
 * cleared, anyone who knew that one public email address could claim founder.
 *
 * A hardcoded credential-adjacent constant is a credential. In production the
 * allow-list must come from configuration, or the app must refuse to start.
 */
const DEV_ONLY_FOUNDERS = ['dev@localhost']

export function getFounderEmails(): string[] {
  const envEmails = process.env.FOUNDER_EMAILS
  if (envEmails) {
    return envEmails
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  }

  // Fail CLOSED in production. An empty list means nobody can bootstrap or log
  // in, which is recoverable by setting the env var. A hardcoded fallback is
  // not recoverable — it is a permanent way in.
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[founders] FOUNDER_EMAILS is not set. Refusing to fall back to a ' +
        'hardcoded allow-list in production. Set it in the environment.',
    )
    return []
  }

  return DEV_ONLY_FOUNDERS
}

export function isFounderEmail(email: string): boolean {
  const founders = getFounderEmails()
  return founders.includes(email.trim().toLowerCase())
}
