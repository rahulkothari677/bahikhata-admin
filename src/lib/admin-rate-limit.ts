/**
 * 🔒 V9 2.4: Redis-backed rate limiter for admin login.
 *
 * Was: in-memory Map → on Vercel serverless, each instance has its own Map
 * → effective limit = 5 × N instances. Resets on every cold start/redeploy.
 *
 * Now: uses Upstash Redis (same as main app). Keyed by email+IP. Shared
 * across all instances. Falls back to in-memory if Redis is not configured
 * (dev mode only — production should always have Redis configured).
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

let redisClient: Redis | null = null
let limiter: Ratelimit | null = null

function getRedis(): Redis | null {
  if (redisClient !== null) return redisClient
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    redisClient = null
    return null
  }
  redisClient = new Redis({ url, token })
  return redisClient
}

function getLimiter(): Ratelimit | null {
  if (limiter !== null) return limiter
  const redis = getRedis()
  if (!redis) return null
  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),  // 5 attempts per 15 min
    prefix: 'admin-login',
  })
  return limiter
}

/**
 * Check if the admin login rate limit has been exceeded.
 * Returns { success, retryAfterSec }.
 *
 * Uses Upstash Redis if configured, falls back to in-memory for dev.
 */
export async function checkAdminLoginRate(
  email: string,
  ip: string,
): Promise<{ success: boolean; retryAfterSec: number }> {
  const key = `${email}:${ip}`
  const limiter = getLimiter()

  if (limiter) {
    // Redis-backed (production)
    const result = await limiter.limit(key)
    return {
      success: result.success,
      retryAfterSec: result.success ? 0 : Math.ceil((result.reset - Date.now()) / 1000),
    }
  }

  // In-memory fallback (dev only)
  return checkInMemory(key)
}

/**
 * 🔒 TOTP BRUTE-FORCE PROTECTION (audit 2026-07-28).
 *
 * Second-factor verification had NO rate limit at all. A TOTP code is six
 * digits — one million possibilities — and each code stays valid for 30
 * seconds, with a ±1 step tolerance for clock drift, so roughly 90 seconds of
 * validity per code. Unlimited guessing turns "something you have" into
 * "something you can guess", which defeats the entire point of the second
 * factor.
 *
 * Kept SEPARATE from the login limiter deliberately:
 *   - a different prefix, so exhausting one does not lock the other
 *   - keyed by adminId, not email+IP, because step-up happens INSIDE an
 *     authenticated session where the identity is already known and an
 *     attacker on a stolen session could otherwise just rotate IPs
 *
 * 5 attempts per 5 minutes. A real operator mistypes once or twice; nobody
 * legitimately needs six tries.
 */
let totpLimiter: Ratelimit | null = null

function getTotpLimiter(): Ratelimit | null {
  if (totpLimiter !== null) return totpLimiter
  const redis = getRedis()
  if (!redis) return null
  totpLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '5 m'),
    prefix: 'admin-totp',
  })
  return totpLimiter
}

export async function checkTotpRate(
  adminId: string,
): Promise<{ success: boolean; retryAfterSec: number }> {
  const limiter = getTotpLimiter()

  if (limiter) {
    const result = await limiter.limit(adminId)
    return {
      success: result.success,
      retryAfterSec: result.success ? 0 : Math.ceil((result.reset - Date.now()) / 1000),
    }
  }

  // Dev fallback. Uses its own bucket map so a dev without Redis still gets
  // the behaviour, and a test can exercise it.
  return checkInMemoryBucket(totpBuckets, adminId, 5, 5 * 60 * 1000)
}

/** Clear the TOTP counter after a SUCCESSFUL verification. */
export async function resetTotpRate(adminId: string): Promise<void> {
  const limiter = getTotpLimiter()
  if (limiter) {
    try {
      await getRedis()?.del(`admin-totp:${adminId}`)
    } catch {
      // Non-critical — the sliding window expires on its own.
    }
    return
  }
  totpBuckets.delete(adminId)
}

/**
 * Reset the rate limit for a given email+IP (call on successful login).
 */
export async function resetAdminLoginRate(email: string, ip: string): Promise<void> {
  const key = `${email}:${ip}`
  const limiter = getLimiter()

  if (limiter) {
    // Redis: delete the key to reset the counter
    try {
      await getRedis()?.del(`admin-login:${key}`)
    } catch {
      // Non-critical — the sliding window will expire naturally
    }
    return
  }

  // In-memory fallback
  inMemoryBuckets.delete(key)
}

// ─── In-memory fallback (dev only) ───
interface RateBucket { count: number; resetAt: number }
const inMemoryBuckets = new Map<string, RateBucket>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** TOTP dev-fallback buckets. Separate map so the two limits cannot interfere. */
const totpBuckets = new Map<string, RateBucket>()

/**
 * Shared in-memory bucket check.
 *
 * ⚠️ DEV ONLY, and the reason is worth stating: on Vercel each serverless
 * instance holds its own Map, so the effective limit is (max × instances) and
 * it resets on every cold start. In production UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN must be set, or these limits are close to no limit
 * at all.
 */
export function checkInMemoryBucket(
  buckets: Map<string, RateBucket>,
  key: string,
  max: number,
  windowMs: number,
): { success: boolean; retryAfterSec: number } {
  const now = Date.now()
  let bucket = buckets.get(key)

  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }

  if (bucket.count >= max) {
    return { success: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count++
  return { success: true, retryAfterSec: 0 }
}

function checkInMemory(key: string): { success: boolean; retryAfterSec: number } {
  return checkInMemoryBucket(inMemoryBuckets, key, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
}

/**
 * True when Redis is configured. Used by the health check so a production
 * deployment without Redis is VISIBLE rather than silently near-unlimited.
 */
export function isRateLimitBackedByRedis(): boolean {
  return getRedis() !== null
}
