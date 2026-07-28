/**
 * Next.js CLIENT instrumentation hook.
 *
 * 🐛 WHY THIS FILE EXISTS (audit 2026-07-28):
 * Next 15.3+ (this project is on 16) no longer picks up `sentry.client.config.ts`
 * automatically. Browser-side Sentry init must happen here or it NEVER RUNS —
 * silently. The config file sits in the repo looking correct, and no browser
 * error is ever captured.
 *
 * Verified against the deployed admin panel before writing this: the Sentry SDK
 * was absent from the page and no DSN appeared in the client bundle, despite
 * sentry.client.config.ts existing and the env var being set.
 *
 * The SAME gap exists in bahikhata-pro, where a test reads
 * sentry.client.config.ts AS TEXT and asserts its contents — so the test passes
 * while the file never executes. That is the "tests validating code that does
 * not ship" pattern this project has hit before.
 *
 * Importing the config keeps ONE source of truth for the Sentry options rather
 * than duplicating them here, where the two copies would drift.
 */
import '../sentry.client.config'

/**
 * Reports client-side navigation timing to Sentry. Exported because Next looks
 * for it by name; harmless when Sentry is not configured.
 */
export { captureRouterTransitionStart as onRouterTransitionStart } from '@sentry/nextjs'
