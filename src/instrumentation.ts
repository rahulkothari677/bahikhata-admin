/**
 * Next.js instrumentation hook — loads Sentry on the server.
 *
 * Next 16 no longer auto-loads sentry.server.config.ts; it must be imported
 * from here or it silently never runs. That failure mode is exactly the one
 * being fixed: monitoring that appears configured but isn't.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
}

/**
 * Captures errors thrown in server components and route handlers that Next
 * surfaces through this hook.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
) {
  if (!process.env.SENTRY_DSN) return
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureException(err, {
    tags: { path: request.path, method: request.method },
  })
}
