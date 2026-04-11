/**
 * CSRF Protection Middleware — Synchronizer Token Pattern
 * 
 * Phase 4 #20: Implements CSRF protection without the deprecated `csurf` package.
 * Uses the Synchronizer Token Pattern (OWASP recommended):
 * 
 * 1. Server generates a crypto-random token, stored in the session
 * 2. Frontend fetches it via GET /api/csrf-token
 * 3. Frontend sends it in the X-CSRF-Token header on state-changing requests
 * 4. Server validates the header matches the session token
 * 
 * Safe methods (GET, HEAD, OPTIONS) are exempt.
 * Webhooks and SSE streams are also exempt (they use different auth).
 */

const crypto = require('crypto');
const log = require('../lib/logger');

const CSRF_TOKEN_LENGTH = 32;  // 256-bit token
const CSRF_HEADER = 'x-csrf-token';

// Routes exempt from CSRF (webhooks, SSE streams, public reads)
const CSRF_EXEMPT_PATHS = [
  '/billing/webhook',         // Stripe webhook (validated by signature)
  '/api/agent/stream/',       // SSE stream (read-only after initial POST)
  '/auth/google',             // OAuth redirects (validated by OAuth state parameter)
  '/auth/google/callback',
  '/auth/github',
  '/auth/github/callback',
  '/auth/linkedin',
  '/auth/linkedin/callback',
  '/auth/reset-password',     // Protected by one-time reset token (user arrives from email, no session)
  '/auth/forgot-password',    // No sensitive action (only sends email, anti-enumeration)
  '/api/csp-report',          // Phase 6 Wave 4: Browser CSP reports (no CSRF possible)
  '/api/client-error',        // Phase 6 Wave 4: sendBeacon telemetry (no custom headers)
];

/**
 * Generate a new CSRF token and store in session.
 */
function generateCsrfToken(req) {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  if (req.session) {
    req.session._csrfToken = token;
  }
  return token;
}

/**
 * Get existing CSRF token from session, or generate a new one.
 */
function getCsrfToken(req) {
  if (req.session && req.session._csrfToken) {
    return req.session._csrfToken;
  }
  return generateCsrfToken(req);
}

/**
 * CSRF validation middleware.
 * • Safe methods (GET/HEAD/OPTIONS) are always allowed.
 * • Exempt paths are always allowed.
 * • All other requests require a valid X-CSRF-Token header.
 */
function csrfProtection(req, res, next) {
  // Safe methods don't modify state — no CSRF risk
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Check exempt paths
  for (const exemptPath of CSRF_EXEMPT_PATHS) {
    if (req.path.startsWith(exemptPath)) {
      return next();
    }
  }

  // Validate CSRF token
  const sessionToken = req.session?._csrfToken;
  const headerToken = req.headers[CSRF_HEADER];

  if (!sessionToken || !headerToken) {
    log.warn('CSRF token missing', {
      path: req.path,
      method: req.method,
      hasSession: !!sessionToken,
      hasHeader: !!headerToken,
    });
    return res.status(403).json({
      error: 'Security validation failed. Please refresh the page and try again.',
      code: 'CSRF_TOKEN_MISSING',
    });
  }

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(sessionToken), Buffer.from(headerToken))) {
    log.warn('CSRF token mismatch', { path: req.path, method: req.method });
    return res.status(403).json({
      error: 'Security token expired. Please refresh the page and try again.',
      code: 'CSRF_TOKEN_INVALID',
    });
  }

  // Token is session-bound and reused until session expires.
  // Rotation was removed because concurrent requests (common on mobile)
  // cause the second request to send a stale rotated token → 403.
  next();
}

module.exports = { csrfProtection, getCsrfToken, generateCsrfToken };
