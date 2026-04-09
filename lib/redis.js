/**
 * Redis Client — Upstash Singleton with Graceful Fallback
 *
 * Phase 5 §1: Provides a shared Redis connection for distributed
 * primitives (render semaphore, rate limiting, caching).
 *
 * Architecture:
 *   - Uses ioredis with TLS (Upstash requires it)
 *   - Singleton pattern — one connection shared across the process
 *   - Graceful degradation: returns null if UPSTASH_REDIS_URL is unset
 *     (callers fall back to local in-memory implementations)
 *   - Auto-reconnect with exponential backoff
 *
 * Configuration:
 *   UPSTASH_REDIS_URL=rediss://default:xxxx@us1-...upstash.io:6379
 */

const Redis = require('ioredis');
const log = require('./logger');

let redis = null;
let connectionFailed = false;

/**
 * Get the shared Redis client, or null if Redis is unavailable.
 * Callers MUST handle the null case with a local fallback.
 *
 * @returns {import('ioredis').Redis | null}
 */
function getRedis() {
  if (connectionFailed) return null;
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) {
    log.info('Redis disabled (UPSTASH_REDIS_URL not set) — using local fallbacks');
    connectionFailed = true;
    return null;
  }

  try {
    redis = new Redis(url, {
      lazyConnect: true,               // Don't connect until first command
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
      commandTimeout: 5000,  // Upstash serverless can have cold-start latency >2s
      retryStrategy(times) {
        if (times > 5) {
          log.error('Redis max retries reached — falling back to local');
          connectionFailed = true;
          return null; // Stop retrying
        }
        return Math.min(times * 200, 3000);
      },
      tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    });

    redis.on('connect', () => {
      log.info('Redis connected', { host: url.split('@')[1]?.split(':')[0] || 'unknown' });
    });

    redis.on('error', (err) => {
      log.error('Redis connection error', { error: err.message });
    });

    redis.on('close', () => {
      log.warn('Redis connection closed');
    });

    return redis;
  } catch (err) {
    log.error('Redis initialization failed', { error: err.message });
    connectionFailed = true;
    return null;
  }
}

/**
 * Gracefully close the Redis connection (call on shutdown).
 */
async function closeRedis() {
  if (redis) {
    try {
      await redis.quit();
      log.info('Redis connection closed');
    } catch { /* ignore */ }
    redis = null;
  }
}

/**
 * Health check — returns true if Redis is connected and responsive.
 */
async function isRedisHealthy() {
  try {
    const client = getRedis();
    if (!client) return false;
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

module.exports = { getRedis, closeRedis, isRedisHealthy };
