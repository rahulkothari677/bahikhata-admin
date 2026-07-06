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

function checkInMemory(key: string): { success: boolean; retryAfterSec: number } {
  const now = Date.now()
  let bucket = inMemoryBuckets.get(key)

  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    inMemoryBuckets.set(key, bucket)
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return { success: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count++
  return { success: true, retryAfterSec: 0 }
}
