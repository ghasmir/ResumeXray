/**
 * Playwright Browser Manager — Singleton + Distributed Concurrency Control
 *
 * Phase 5 §1: Upgraded from in-memory semaphore to Redis Sorted Set-based
 * distributed counting semaphore (via Upstash). Ensures the render limit
 * is respected globally across all PM2 cluster workers.
 *
 * Architecture:
 *   - Redis Sorted Set `rx:render:slots` tracks active leases
 *   - Each lease has score = acquisition timestamp (for TTL expiry)
 *   - Stale leases (crashed workers) auto-expire after LEASE_TTL_MS
 *   - Graceful fallback: if Redis unavailable, uses local in-memory semaphore
 *
 * Usage in resume-builder.js:
 *   const { getBrowser, acquireRenderSlot, releaseRenderSlot } = require('./playwright-browser');
 *   const leaseId = await acquireRenderSlot();
 *   try {
 *     const browser = await getBrowser();
 *     // ... render PDF ...
 *   } finally {
 *     await releaseRenderSlot(leaseId);
 *   }
 */

const crypto = require('crypto');
const { chromium } = require('playwright-core');
const log = require('./logger');
const { getRedis } = require('./redis');

let browserPromise = null;

// ── Browser Singleton ──────────────────────────────────────────────────────────

/**
 * Get the shared browser instance (creates on first call).
 * @returns {Promise<import('playwright-core').Browser>}
 */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ]
    }).then(browser => {
      browser.on('disconnected', () => {
        browserPromise = null;
        log.warn('Chromium browser disconnected — will re-launch on next request');
      });
      log.info('Chromium browser launched');
      return browser;
    }).catch(err => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Gracefully close the browser (call on SIGINT/SIGTERM).
 */
async function closeBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      browserPromise = null;
      await browser.close();
      log.info('Chromium browser closed');
    } catch (e) {
      browserPromise = null;
    }
  }
}

// ── Render Concurrency: Distributed (Redis) + Local Fallback ──────────────────

const MAX_CONCURRENT_RENDERS = parseInt(process.env.MAX_CONCURRENT_RENDERS, 10) || 3;
const SEMAPHORE_KEY = 'rx:render:slots';
const LEASE_TTL_MS  = 30_000; // 30s max render time before auto-expiry
const POLL_INTERVAL = 500;    // Check every 500ms for available slot
const POLL_TIMEOUT  = 15_000; // Max wait time for a slot

// ── Local Fallback Semaphore (used when Redis unavailable) ────────────────────

let localActiveRenders = 0;
const localRenderQueue = [];

function localAcquire() {
  if (localActiveRenders < MAX_CONCURRENT_RENDERS) {
    localActiveRenders++;
    log.debug('Render slot acquired (local)', { active: localActiveRenders });
    return Promise.resolve('local');
  }
  return new Promise((resolve) => {
    localRenderQueue.push(() => resolve('local'));
    log.debug('Render slot queued (local)', { queued: localRenderQueue.length });
  });
}

function localRelease() {
  if (localRenderQueue.length > 0) {
    const next = localRenderQueue.shift();
    next();
  } else {
    localActiveRenders--;
  }
}

// ── Redis Distributed Semaphore ───────────────────────────────────────────────

/**
 * Acquire a render slot. Returns a leaseId that MUST be passed to releaseRenderSlot().
 *
 * Uses Redis Sorted Set for cross-process coordination:
 *   - ZADD with timestamp score (acts as lease acquisition time)
 *   - ZREMRANGEBYSCORE to evict stale leases from crashed workers
 *   - ZCARD to check current count
 *
 * @returns {Promise<string>} leaseId — pass to releaseRenderSlot()
 */
async function acquireRenderSlot() {
  const redis = getRedis();
  if (!redis) return localAcquire();

  const leaseId = `${process.pid}:${crypto.randomUUID()}`;

  try {
    // Evict stale leases (from crashed workers)
    await redis.zremrangebyscore(SEMAPHORE_KEY, '-inf', Date.now() - LEASE_TTL_MS);

    // Poll for available slot
    const deadline = Date.now() + POLL_TIMEOUT;
    while (Date.now() < deadline) {
      const count = await redis.zcard(SEMAPHORE_KEY);
      if (count < MAX_CONCURRENT_RENDERS) {
        await redis.zadd(SEMAPHORE_KEY, Date.now(), leaseId);
        log.debug('Render slot acquired (redis)', { leaseId, active: count + 1 });
        return leaseId;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    // Timeout — could not acquire slot
    log.warn('Render slot timeout — falling back to local', { waitedMs: POLL_TIMEOUT });
    return localAcquire();
  } catch (err) {
    log.error('Redis semaphore failed — falling back to local', { error: err.message });
    return localAcquire();
  }
}

/**
 * Release a render slot.
 * @param {string} leaseId — the lease returned by acquireRenderSlot()
 */
async function releaseRenderSlot(leaseId) {
  if (!leaseId || leaseId === 'local') {
    localRelease();
    return;
  }

  const redis = getRedis();
  if (!redis) {
    localRelease();
    return;
  }

  try {
    await redis.zrem(SEMAPHORE_KEY, leaseId);
    log.debug('Render slot released (redis)', { leaseId });
  } catch (err) {
    log.error('Redis semaphore release failed', { error: err.message, leaseId });
  }
}

/**
 * Get current render queue stats (for health check endpoints).
 */
async function getRenderStats() {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.zremrangebyscore(SEMAPHORE_KEY, '-inf', Date.now() - LEASE_TTL_MS);
      const active = await redis.zcard(SEMAPHORE_KEY);
      return { active, max: MAX_CONCURRENT_RENDERS, backend: 'redis' };
    } catch { /* fall through to local */ }
  }
  return {
    active: localActiveRenders,
    queued: localRenderQueue.length,
    max: MAX_CONCURRENT_RENDERS,
    backend: 'local',
  };
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  getBrowser,
  closeBrowser,
  acquireRenderSlot,
  releaseRenderSlot,
  getRenderStats,
};
