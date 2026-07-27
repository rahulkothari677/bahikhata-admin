/**
 * Turns an API error response into a message a human can act on.
 *
 * WHY (audit 2026-07-27): withAdmin() standardised error responses to
 *
 *     { error: { code, message, requestId } }
 *
 * which is right — a typed shape with a traceable id beats a bare string. But
 * 46 call sites across 22 pages were written against the OLD shape:
 *
 *     throw new Error(data.error || `HTTP ${r.status}`)
 *
 * `data.error` is now an OBJECT, and `new Error(object)` stringifies to
 * "[object Object]". So every error toast in the admin panel silently became
 * "[object Object]" the moment the routes were migrated — a regression
 * introduced by the migration itself, invisible to tsc because these responses
 * are untyped through fetch().
 *
 * This reads BOTH shapes. The legacy string form still exists on the handful
 * of routes that are deliberately public and unwrapped.
 *
 * It also surfaces the requestId. When an operator reports "it failed", the
 * difference between that and "it failed, ref 8f3a-...", is the difference
 * between guessing and grepping the logs.
 */

interface StructuredError {
  code?: string
  message?: string
  requestId?: string
}

export function readApiError(
  body: unknown,
  status?: number,
): string {
  const data = body as { error?: string | StructuredError; message?: string } | null

  if (data && typeof data.error === 'object' && data.error !== null) {
    const e = data.error as StructuredError
    const base = e.message || e.code || 'Request failed'
    return e.requestId ? `${base} (ref: ${e.requestId.slice(0, 8)})` : base
  }

  if (data && typeof data.error === 'string' && data.error) return data.error
  if (data && typeof data.message === 'string' && data.message) return data.message

  return status ? `Request failed (HTTP ${status})` : 'Request failed'
}
