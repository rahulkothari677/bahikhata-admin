/**
 * Founder email whitelist — only these emails can access the admin panel.
 *
 * To add a new admin: add their email here, deploy, then they can create
 * their account at /login.
 *
 * For production, set the FOUNDER_EMAILS env var (comma-separated).
 * This file is the fallback for development.
 */

const DEFAULT_FOUNDERS = [
  'rahulkothari677@gmail.com',
]

export function getFounderEmails(): string[] {
  const envEmails = process.env.FOUNDER_EMAILS
  if (envEmails) {
    return envEmails
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  }
  return DEFAULT_FOUNDERS
}

export function isFounderEmail(email: string): boolean {
  const founders = getFounderEmails()
  return founders.includes(email.trim().toLowerCase())
}
