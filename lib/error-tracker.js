/**
 * Error Tracking — Sentry Integration (Lazy-Load)
 *
 * Provides a thin wrapper around Sentry that:
 *   1. Only loads @sentry/node when SENTRY_DSN is set
 *   2. Enriches errors with request context (userId, path, requestId)
 *   3. Strips PII from breadcrumbs
 *   4. Samples performance at 10% (free tier budget)
 *
 * Usage:
 *   const { initSentry, captureError } = require('./error-tracker');
 *   initSentry(app); // Call before routes
 *   captureError(err, { userId, scanId }); // Manual capture
 */

const log = require('./logger');

let Sentry = null;
let initialized = false;

/**
 * Phase 1: Initialize Sentry SDK BEFORE Express is imported.
 * This enables auto-instrumentation of http, express, etc.
 * Called at the very top of server.js.
 */
function initSentryEarly() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info('Sentry disabled (SENTRY_DSN not set)');
    return;
  }

  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: `resumexray@${require('../package.json').version}`,
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.05,
      beforeSend(event) {
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
        }
        return event;
      },
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === 'http' && breadcrumb.data) {
          delete breadcrumb.data.headers;
        }
        return breadcrumb;
      },
      ignoreErrors: [
        'ECONNRESET', 'EPIPE', 'ECANCELED',
        'AbortError', 'ERR_STREAM_WRITE_AFTER_END',
      ],
    });
    initialized = true;
    log.info('Sentry initialized', { dsn: dsn.split('@')[1]?.split('/')[0] || 'configured' });
  } catch (err) {
    log.warn('Sentry initialization failed', { error: err.message });
  }
}

/**
 * Phase 2: Attach Sentry error handler middleware to Express app.
 * Called after app creation, before the global error handler.
 * @param {import('express').Express} app
 */
function initSentry(app) {
  if (!initialized || !Sentry) return;

  try {
    Sentry.setupExpressErrorHandler(app);
    log.info('Sentry Express error handler attached');
  } catch (err) {
    log.warn('Sentry Express handler failed', { error: err.message });
  }
}

/**
 * Capture an error with optional context.
 * @param {Error} error
 * @param {object} context - { userId, scanId, path, ... }
 */
function captureError(error, context = {}) {
  if (!initialized || !Sentry) {
    // Just log it — Sentry not available
    return;
  }

  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: String(context.userId) });
    if (context.scanId) scope.setTag('scanId', context.scanId);
    if (context.path) scope.setTag('path', context.path);
    Object.entries(context).forEach(([key, val]) => {
      if (!['userId', 'scanId', 'path'].includes(key)) {
        scope.setExtra(key, val);
      }
    });
    Sentry.captureException(error);
  });
}

/**
 * Flush pending events before shutdown.
 */
async function flushSentry() {
  if (initialized && Sentry) {
    await Sentry.close(2000);
    log.info('Sentry flushed');
  }
}

module.exports = { initSentryEarly, initSentry, captureError, flushSentry };
