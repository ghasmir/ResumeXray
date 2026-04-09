/**
 * Application Error Classes — Centralized Error Hierarchy
 *
 * Why: Google engineering standards require typed errors with:
 *  1. Standardized HTTP status codes
 *  2. Machine-readable error codes for frontend consumption
 *  3. Safe error messages (no stack traces or internal details leaked to clients)
 *  4. Operational vs. Programmer error distinction
 *
 * Usage:
 *   const { ValidationError, AuthenticationError, NotFoundError } = require('./errors');
 *   throw new ValidationError('Resume file is required.');
 *   throw new AuthenticationError('Session expired. Please log in again.');
 *   throw new NotFoundError('Scan', scanId);
 *
 * The global error handler in server.js catches these and returns
 * standardized JSON responses.
 */

// ── Base Application Error ─────────────────────────────────────────────────────

class AppError extends Error {
  /**
   * @param {string} message   - Human-readable error message (safe for client)
   * @param {number} statusCode - HTTP status code
   * @param {string} code       - Machine-readable error code
   * @param {boolean} isOperational - true = expected/handled, false = bug/crash
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    // Capture stack trace, excluding the constructor
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serialize to a safe JSON response (no internal details).
   */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// ── Specific Error Types ───────────────────────────────────────────────────────

/**
 * 400 Bad Request — Invalid input, malformed payload, failed validation.
 */
class ValidationError extends AppError {
  constructor(message = 'Invalid input.', details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * 401 Unauthorized — Missing or invalid authentication.
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication required.') {
    super(message, 401, 'AUTH_REQUIRED');
  }
}

/**
 * 403 Forbidden — Authenticated but not authorized for this resource.
 */
class ForbiddenError extends AppError {
  constructor(message = 'Access denied.') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * 404 Not Found — Resource does not exist or is not accessible.
 */
class NotFoundError extends AppError {
  /**
   * @param {string} resource - What wasn't found (e.g., 'Scan', 'Resume')
   * @param {string|number} id - The ID that was searched for
   */
  constructor(resource = 'Resource', id = '') {
    super(`${resource} not found.`, 404, 'NOT_FOUND');
    this.resource = resource;
    this.resourceId = id;
  }
}

/**
 * 409 Conflict — Resource state conflict (e.g., duplicate entry).
 */
class ConflictError extends AppError {
  constructor(message = 'Resource conflict.') {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * 429 Too Many Requests — Rate limit exceeded.
 */
class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, 429, 'RATE_LIMITED');
  }
}

/**
 * 402 Payment Required — Insufficient credits.
 */
class InsufficientCreditsError extends AppError {
  constructor(message = 'Insufficient credits.', details = null) {
    super(message, 402, 'INSUFFICIENT_CREDITS');
    this.details = details;
  }
}

/**
 * 503 Service Unavailable — External dependency failure (LLM, Stripe, etc.).
 */
class ExternalServiceError extends AppError {
  constructor(serviceName = 'External Service', originalError = null) {
    super(`${serviceName} is temporarily unavailable.`, 503, 'SERVICE_UNAVAILABLE');
    this.serviceName = serviceName;
    if (originalError) {
      this.originalMessage = originalError.message;
    }
  }
}

/**
 * Non-operational error — indicates a programmer bug.
 * These should crash the process (in production, PM2/Docker restarts it).
 */
class ProgrammerError extends AppError {
  constructor(message = 'Internal error.') {
    super(message, 500, 'INTERNAL_ERROR', false);
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InsufficientCreditsError,
  ExternalServiceError,
  ProgrammerError,
};
