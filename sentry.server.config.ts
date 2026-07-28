import * as Sentry from '@sentry/nextjs'

/**
 * Sentry server-side configuration for the ADMIN panel.
 *
 * WHY (audit 2026-07-28): there was no monitoring at all. The global error
 * boundary carried the comment "in production, this goes to Sentry" while
 * Sentry was not installed — so an admin-panel crash in production wrote to a
 * browser console nobody was watching, and nothing reached the founder. The
 * comment described behaviour that did not exist.
 *
 * Enable by setting SENTRY_DSN in Vercel. Without it this is a no-op, so local
 * development and CI are unaffected.
 *
 * ⚠️ THE ADMIN PANEL IS NOT THE MAIN APP.
 * Errors here can carry a shopkeeper's data in their payloads — a Prisma
 * validation error embeds the field values that failed. Sending those to a
 * third party would be an unlawful disclosure under DPDP, so the scrubbing
 * below is a compliance control, not tidiness. It is deliberately WIDER than
 * the main app's list.
 */

const SENTRY_DSN = process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Admin traffic is low volume (a handful of operators), so a higher rate
    // than the main app is affordable and gives better signal on rare paths.
    tracesSampleRate: 0.2,

    environment: process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local',

    ignoreErrors: [
      // Our own controls, working as designed. Alerting on them would train
      // the founder to ignore Sentry.
      'Too many incorrect codes',
      'rate limit exceeded',
      'STEP_UP_REQUIRED',
      'FORBIDDEN',
      'UNAUTHENTICATED',
    ],

    beforeSend(event) {
      // Wider than the main app's pattern: the admin panel touches shopkeeper
      // identifiers, their CUSTOMERS' details, and EkBook's own secrets.
      const SENSITIVE_KEY_RE =
        /amount|phone|gstin|email|name|password|token|secret|upi|address|pan|aadhaar|invoice|totp|dsn|url/i

      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (SENSITIVE_KEY_RE.test(key)) delete event.extra[key]
        }
      }

      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.data) {
            for (const key of Object.keys(crumb.data)) {
              if (SENSITIVE_KEY_RE.test(key)) delete crumb.data[key]
            }
          }
        }
      }

      // A query string on an admin route can carry a search term — which is
      // very often a shopkeeper's name or phone number. Drop it entirely.
      if (event.request?.query_string) delete event.request.query_string
      if (event.request?.cookies) delete event.request.cookies
      if (event.request?.headers) {
        delete event.request.headers['authorization']
        delete event.request.headers['cookie']
        delete event.request.headers['x-setup-secret']
      }

      return event
    },
  })
}
