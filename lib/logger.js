/**
 * Structured Logger — Production-Grade Logging for ResumeXray
 *
 * Replaces raw console.log() calls with structured, leveled output.
 *
 * Why: Google/FAANG engineering standards mandate structured logging with:
 *  1. Log levels (debug, info, warn, error, fatal)
 *  2. Timestamps in ISO-8601
 *  3. Machine-parseable format (JSON in production, human-readable in dev)
 *  4. Contextual metadata (userId, scanId, requestId, etc.)
 *  5. No PII in logs — emails, names, and tokens must be redacted
 *
 * Usage:
 *   const log = require('./logger');
 *   log.info('Scan created', { scanId: 42, userId: 7 });
 *   log.error('PDF generation failed', { scanId: 42, error: err.message });
 *   log.warn('Rate limit approaching', { ip: '1.2.3.4', count: 180 });
 *
 * In production, pipe stdout to a log aggregator (Datadog, GCP Cloud Logging, etc.)
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const LEVEL_LABELS = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
  4: 'FATAL',
};

// Set minimum log level from environment (default: debug in dev, info in prod)
const ENV = process.env.NODE_ENV || 'development';
const MIN_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ??
  (ENV === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug);

// ── PII Redaction ──────────────────────────────────────────────────────────────

const PII_PATTERNS = [
  { key: 'email', replace: (v) => v.replace(/(.{2}).*(@.*)/, '$1***$2') },
  { key: 'password', replace: () => '[REDACTED]' },
  { key: 'passwordHash', replace: () => '[REDACTED]' },
  { key: 'password_hash', replace: () => '[REDACTED]' },
  { key: 'token', replace: () => '[REDACTED]' },
  { key: 'secret', replace: () => '[REDACTED]' },
  { key: 'apiKey', replace: () => '[REDACTED]' },
  { key: 'api_key', replace: () => '[REDACTED]' },
  { key: 'authorization', replace: () => '[REDACTED]' },
];

function redactPII(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const cleaned = { ...meta };
  for (const { key, replace } of PII_PATTERNS) {
    if (cleaned[key] && typeof cleaned[key] === 'string') {
      cleaned[key] = replace(cleaned[key]);
    }
  }
  return cleaned;
}

// ── Core Logger ────────────────────────────────────────────────────────────────

function formatLog(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: LEVEL_LABELS[level],
    message,
    ...redactPII(meta),
  };

  if (ENV === 'production') {
    // Machine-parseable JSON for log aggregators
    return JSON.stringify(entry);
  }

  // Human-readable for development
  const levelLabel = LEVEL_LABELS[level].padEnd(5);
  const metaStr = Object.keys(meta).length > 0
    ? ' ' + JSON.stringify(redactPII(meta))
    : '';
  return `${entry.timestamp} [${levelLabel}] ${message}${metaStr}`;
}

function log(level, message, meta = {}) {
  if (level < MIN_LEVEL) return;

  const formatted = formatLog(level, message, meta);

  if (level >= LOG_LEVELS.error) {
    process.stderr.write(formatted + '\n');
  } else {
    process.stdout.write(formatted + '\n');
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

module.exports = {
  debug: (message, meta) => log(LOG_LEVELS.debug, message, meta),
  info:  (message, meta) => log(LOG_LEVELS.info, message, meta),
  warn:  (message, meta) => log(LOG_LEVELS.warn, message, meta),
  error: (message, meta) => log(LOG_LEVELS.error, message, meta),
  fatal: (message, meta) => log(LOG_LEVELS.fatal, message, meta),

  /**
   * Create a child logger with pre-bound context.
   * Usage:
   *   const reqLog = log.child({ requestId: req.id, userId: req.user?.id });
   *   reqLog.info('Processing scan');
   */
  child(context) {
    return {
      debug: (msg, meta) => log(LOG_LEVELS.debug, msg, { ...context, ...meta }),
      info:  (msg, meta) => log(LOG_LEVELS.info,  msg, { ...context, ...meta }),
      warn:  (msg, meta) => log(LOG_LEVELS.warn,  msg, { ...context, ...meta }),
      error: (msg, meta) => log(LOG_LEVELS.error, msg, { ...context, ...meta }),
      fatal: (msg, meta) => log(LOG_LEVELS.fatal, msg, { ...context, ...meta }),
    };
  },

  // Expose for testing
  LOG_LEVELS,
};
