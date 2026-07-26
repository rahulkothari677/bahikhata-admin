/**
 * 🐛 INTEGRATION PHASE D.4 (2026-07-25): tokenVersion cache invalidation.
 *
 * The main app's NextAuth caches each user's `tokenVersion` in Redis
 * (key: `tv:{userId}`, TTL: 5 seconds) so it can check JWT revocation
 * on every request without hitting the DB.
 *
 * When the admin app changes a user's plan or bans them, we bump the
 * user's `tokenVersion` in the DB (via Prisma). But the main app's
 * Redis cache still holds the OLD tokenVersion for up to 5 seconds.
 * This means the user's existing JWT stays valid for up to 5 seconds
 * after the admin action — usually fine, but we can make it instant
 * by deleting the Redis cache entry.
 *
 * This helper deletes `tv:{userId}` from the shared Redis instance.
 * The main app's next request for that user will cache-miss and read
 * the new tokenVersion from the DB.
 *
 * SECURITY: This is a defense-in-depth speedup. Even without it, the
 * 5-second Redis TTL ensures revocation happens within 5 seconds. With
 * it, revocation is instant. Either way, the user's old JWT is invalid
 * once the main app sees the new tokenVersion.
 *
 * The Redis instance is SHARED with the main app (same
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars). This is
 * documented in the admin app's .env.example: "Use the SAME Upstash Redis
 * instance as the main app (shared rate limit state)."
 */

import { Redis } from '@upstash/redis'

let redisClient: Redis | null = null
let redisInitAttempted = false

function getRedis(): Redis | null {
  if (redisClient !== null) return redisClient
  if (redisInitAttempted) return null // avoid retrying on every call

  redisInitAttempted = true
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    return null
  }
  try {
    redisClient = new Redis({ url, token })
  } catch {
    redisClient = null
  }
  return redisClient
}

/**
 * Invalidate the main app's tokenVersion cache for a single user.
 * Call this AFTER bumping the user's tokenVersion in the DB.
 *
 * Safe to call even if Redis is not configured (no-op in that case —
 * the 5-second TTL will expire the cache naturally).
 */
export async function invalidateTokenVersionCache(userId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return // dev mode or Redis misconfigured — 5s TTL handles it

  try {
    await redis.del(`tv:${userId}`)
  } catch {
    // Non-critical — the 5s TTL will expire the cache naturally.
    // Don't throw: this is a speedup, not a correctness requirement.
  }
}

/**
 * Invalidate the main app's tokenVersion cache for multiple users (bulk).
 * Call this AFTER bumping multiple users' tokenVersion in the DB.
 *
 * Uses a pipeline to delete all keys in one round-trip (efficient for
 * bulk operations).
 */
export async function invalidateTokenVersionCacheBulk(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return

  const redis = getRedis()
  if (!redis) return

  try {
    // Upstash Redis pipeline — one round-trip for all deletions
    const pipeline = redis.pipeline()
    for (const userId of userIds) {
      pipeline.del(`tv:${userId}`)
    }
    await pipeline.exec()
  } catch {
    // Non-critical — the 5s TTL will expire the caches naturally.
  }
}
