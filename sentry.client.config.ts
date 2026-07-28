import * as Sentry from '@sentry/nextjs'

/**
 * Sentry browser configuration for the ADMIN panel.
 *
 * Captures React render errors and unhandled browser exceptions — the crashes
 * that previously went to a console nobody was watching.
 *
 * Enable with NEXT_PUBLIC_SENTRY_DSN in Vercel. No DSN = no-op.
 *
 * ⚠️ SESSION REPLAY IS DELIBERATELY NOT ENABLED HERE.
 * The main app uses it. This panel must not: a replay of an admin session is a
 * recording of a shopkeeper's books, their customers' names and their money,
 * streamed to a third party. Even with masking that is a data-transfer decision
 * requiring its own lawful basis, not a debugging convenience. If it is ever
 * added, it needs a DPIA first.
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.2,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local',

    // No replay integration. See the note above — this is intentional.
    integrations: [],

    ignoreErrors: [
      // Browser/extension noise that is not our bug.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      // Our own controls behaving correctly.
      'Too many incorrect codes',
      'STEP_UP_REQUIRED',
    ],

    beforeSend(event) {
      // Only report genuine crashes. Counting handled network hiccups as
      // crashes produces a fake-bad crash-free rate, which then gets ignored.
      if (!event.exception) return null

      const SENSITIVE_KEY_RE =
        /amount|phone|gstin|email|name|password|token|secret|upi|address|pan|aadhaar|invoice|totp/i

      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (SENSITIVE_KEY_RE.test(key)) delete event.extra[key]
        }
      }

      // The admin URL itself leaks: /users/<id>, ?search=<a person's name>.
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url)
          u.search = ''
          event.request.url = u.toString()
        } catch {
          delete event.request.url
        }
      }

      return event
    },
  })
}
