/**
 * Security middleware — Helmet CSP, rate limiters, input sanitization.
 *
 * Hardening notes (Phase 5):
 *  • CSP: `upgradeInsecureRequests` must be `true` (not `[]`) to actually enable.
 *  • `style-src 'unsafe-inline'` retained pending inline-style cleanup (tracked).
 *  • Rate limiters use Upstash Redis (shared across PM2 workers) when
 *    UPSTASH_REDIS_URL is set; fall back to in-memory with a loud warning.
 *  • `Permissions-Policy` denies all powerful features we don't use.
 *  • Input sanitization delegates to `sanitize-html` (not hand-rolled regex).
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const log = require('../lib/logger');

// ── CSP Nonce ─────────────────────────────────────────────────────────────────
function cspNonceMiddleware(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

// ── Helmet / CSP ──────────────────────────────────────────────────────────────
function configureHelmet() {
  const isProd = process.env.NODE_ENV === 'production';

  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      (req, res) => `'nonce-${res.locals.cspNonce}'`,
      "'strict-dynamic'",
      "https://js.stripe.com",
      "https://accounts.google.com",
    ],
    scriptSrcAttr: ["'none'"], // block all inline event handlers
    // §4.8: Google Fonts removed — fonts are self-hosted
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'", "data:"],
    imgSrc: ["'self'", "data:", "https:", "blob:"],
    connectSrc: [
      "'self'",
      "https://api.stripe.com",
      "https://accounts.google.com",
    ],
    frameSrc: [
      "'self'",
      "https://js.stripe.com",
      "https://hooks.stripe.com",
      "https://accounts.google.com",
    ],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: [
      "'self'",
      "https://accounts.google.com",
      "https://checkout.stripe.com",
    ],
    frameAncestors: ["'self'"],
    workerSrc: ["'self'", "blob:"],
    manifestSrc: ["'self'"],
    mediaSrc: ["'self'"],
    // CSP violation reports (wire to Sentry or a dedicated collector)
    reportUri: [process.env.CSP_REPORT_URI || '/api/csp-report'],
  };

  if (isProd) {
    cspDirectives.upgradeInsecureRequests = []; // enable (Helmet treats `[]` as "present without value")
  }

  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives,
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // needed for Stripe/Google popups
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: {
      maxAge: 63072000, // 2 years
      includeSubDomains: true,
      preload: true,
    },
    // Helmet defaults on: nosniff, X-Download-Options, XSS-Protection off
  });
}

// ── Permissions-Policy ────────────────────────────────────────────────────────
// Denies every powerful feature we don't use. Big reduction in XSS blast radius.
function permissionsPolicyMiddleware(req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'clipboard-read=()',
      'clipboard-write=(self)',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'hid=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=(self "https://js.stripe.com")',
      'picture-in-picture=()',
      'publickey-credentials-get=(self)',
      'screen-wake-lock=()',
      'serial=()',
      'sync-xhr=()',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  );
  // Belt-and-braces clickjacking defense alongside CSP frame-ancestors
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
}

// ── Rate Limiter Store Factory ────────────────────────────────────────────────
// If Redis is reachable, every limiter shares state across PM2 workers.
// If not, we fall back to in-process memory and log a loud warning ONCE so
// dev is painless but prod misconfiguration screams.
let rateLimitStoreBuilder = null;
let fallbackLogged = false;

function buildRateLimitStore(prefix) {
  if (rateLimitStoreBuilder === null) {
    const url = process.env.UPSTASH_REDIS_URL;
    if (!url) {
      if (!fallbackLogged) {
        const msg =
          'Rate limiters using in-memory store (UPSTASH_REDIS_URL not set). ' +
          'This is UNSAFE under PM2 cluster mode — limits are per-worker, not global.';
        if (process.env.NODE_ENV === 'production') log.error(msg);
        else log.warn(msg);
        fallbackLogged = true;
      }
      rateLimitStoreBuilder = false;
      return undefined; // express-rate-limit uses MemoryStore by default
    }
    try {
      const { RedisStore } = require('rate-limit-redis');
      const { getRedis } = require('../lib/redis');
      const client = getRedis();
      if (!client) {
        rateLimitStoreBuilder = false;
        return undefined;
      }
      rateLimitStoreBuilder = (p) =>
        new RedisStore({
          sendCommand: (...args) => client.call(...args),
          prefix: `rl:${p}:`,
        });
      log.info('Rate limiters using Upstash Redis store');
    } catch (err) {
      log.warn('rate-limit-redis not installed — falling back to MemoryStore', {
        error: err.message,
      });
      rateLimitStoreBuilder = false;
      return undefined;
    }
  }
  return rateLimitStoreBuilder ? rateLimitStoreBuilder(prefix) : undefined;
}

// ── Key Generator (user id preferred, IP fallback) ────────────────────────────
function keyByUserOrIp(req) {
  if (req.user && req.user.id) return `u:${req.user.id}`;
  // express-rate-limit already strips proxy chain if `trust proxy` is set.
  return `ip:${req.ip || 'unknown'}`;
}

function makeLimiter({ prefix, windowMs, max, message, skipSuccessfulRequests = false, keyByIp = false }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
    skipSuccessfulRequests,
    keyGenerator: keyByIp ? (req) => `ip:${req.ip || 'unknown'}` : keyByUserOrIp,
    store: buildRateLimitStore(prefix),
  });
}

// ── Limiters (6-tier) ─────────────────────────────────────────────────────────
const generalLimiter = makeLimiter({
  prefix: 'general',
  windowMs: 60_000,
  max: 200,
  keyByIp: true,
  message: 'Too many requests. Please try again later.',
});

const authLimiter = makeLimiter({
  prefix: 'auth',
  windowMs: 60_000,
  max: 10,
  keyByIp: true,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Please wait 60 seconds.',
});

const apiLimiter = makeLimiter({
  prefix: 'api',
  windowMs: 60_000,
  max: 60,
  message: 'API rate limit exceeded. Please slow down.',
});

const aiLimiter = makeLimiter({
  prefix: 'ai',
  windowMs: 60_000,
  max: 20,
  message: 'AI rate limit reached. Please wait a minute.',
});

const agentLimiter = makeLimiter({
  prefix: 'agent',
  windowMs: 60_000,
  max: 3,
  message: 'Analysis rate limit reached. You can run 3 scans per minute.',
});

const downloadLimiter = makeLimiter({
  prefix: 'download',
  windowMs: 60_000,
  max: 10,
  message: 'Download rate limit reached. Please wait.',
});

// ── Input Sanitizer ───────────────────────────────────────────────────────────
// Strips ALL HTML from plain-text user inputs (job title, JD, company name, …).
// Uses `sanitize-html` with an empty allowlist — regex-free, bypass-resistant.
function sanitizeInput(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') text = String(text);
  // Clamp length first to prevent resource exhaustion.
  if (text.length > 50_000) text = text.slice(0, 50_000);
  return sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    allowedSchemes: [],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
  }).trim();
}

module.exports = {
  configureHelmet,
  cspNonceMiddleware,
  permissionsPolicyMiddleware,
  generalLimiter,
  apiLimiter,
  authLimiter,
  aiLimiter,
  agentLimiter,
  downloadLimiter,
  sanitizeInput,
};
