/**
 * LLM Output Validator — Phase 6 Wave 3
 *
 * Defense-in-depth Layer 3: Validates LLM outputs AFTER generation.
 * 
 * Problem: The sanitizer (Layer 1) and prompt fence (Layer 2) only protect INPUTS.
 * A compromised or hallucinating LLM can still return:
 *   - Injected instructions in its output (second-order injection)
 *   - Suspiciously perfect scores (100/100) that indicate prompt manipulation
 *   - Malformed JSON that crashes downstream code
 *   - Excessively long responses that bloat DB storage
 *   - HTML/script tags that become XSS vectors when rendered
 *
 * This module validates and clamps LLM output before it reaches the caller.
 *
 * Usage:
 *   const { validateScore, validateBulletResult, sanitizeLLMOutput, validateJSON } = require('./output-validator');
 *   const safeScore = validateScore(rawScore, 'ats');
 *   const safeBullet = validateBulletResult(rawBullet);
 */

const log = require('../logger');

// ── Score Validation ──────────────────────────────────────────────────────────

/**
 * Validate and clamp a numeric score from LLM output.
 * Rejects suspiciously perfect scores (100/100 = likely injection).
 *
 * @param {number|string} raw - The raw score from LLM
 * @param {string} type - Score type: 'ats', 'semantic', 'keyword', 'format'
 * @returns {number} Clamped, validated score (0-99 ceiling for anti-manipulation)
 */
function validateScore(raw, type = 'generic') {
  const num = typeof raw === 'string' ? parseFloat(raw) : raw;

  if (typeof num !== 'number' || isNaN(num)) {
    log.warn('LLM returned non-numeric score', { raw, type });
    return 0;
  }

  // Clamp to valid range
  const clamped = Math.max(0, Math.min(100, Math.round(num)));

  // Anti-manipulation: Perfect 100 is suspicious — cap at 98
  // Legitimate resumes rarely score 100 on any metric
  if (clamped === 100) {
    log.warn('LLM returned perfect score — capping at 98', { type, raw: num });
    return 98;
  }

  return clamped;
}

// ── Bullet Result Validation ──────────────────────────────────────────────────

/**
 * Validate a bullet rewrite result from the LLM.
 * Ensures the rewritten text is safe, reasonable length, and not injected.
 *
 * @param {object} result - { original, rewritten, targetKeyword, method, ... }
 * @returns {object} Validated result with safe fields
 */
function validateBulletResult(result) {
  if (!result || typeof result !== 'object') {
    log.warn('LLM returned invalid bullet result');
    return null;
  }

  const validated = { ...result };

  // Validate rewritten text exists and is reasonable
  if (!validated.rewritten || typeof validated.rewritten !== 'string') {
    log.warn('LLM returned empty bullet rewrite');
    validated.rewritten = validated.original || '';
  }

  // Length guard: bullet points should be 1-500 chars
  if (validated.rewritten.length > 500) {
    log.warn('LLM bullet rewrite too long, truncating', {
      length: validated.rewritten.length
    });
    validated.rewritten = validated.rewritten.substring(0, 500);
  }

  // Sanitize output text
  validated.rewritten = sanitizeLLMOutput(validated.rewritten);
  validated.original = sanitizeLLMOutput(validated.original || '');

  // Validate metadata fields
  if (validated.targetKeyword && typeof validated.targetKeyword === 'string') {
    validated.targetKeyword = validated.targetKeyword.substring(0, 100);
  }
  if (validated.method && typeof validated.method === 'string') {
    validated.method = validated.method.substring(0, 100);
  }

  return validated;
}

// ── Output Sanitization ───────────────────────────────────────────────────────

/**
 * Sanitize raw LLM output text to remove injection artifacts.
 * Strips:
 *   - HTML/script tags (XSS defense)
 *   - Markdown code execution patterns
 *   - System prompt artifacts that leaked through
 *   - Excessive whitespace/newlines
 *
 * @param {string} text - Raw LLM output
 * @returns {string} Sanitized text
 */
function sanitizeLLMOutput(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // Strip HTML tags — LLM output should be plaintext or markdown only
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
  cleaned = cleaned.replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '');
  cleaned = cleaned.replace(/<embed[^>]*>[\s\S]*?<\/embed>/gi, '');

  // Strip event handlers that might have leaked
  cleaned = cleaned.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');

  // Strip data URIs (potential XSS via javascript: protocol)
  cleaned = cleaned.replace(/(?:javascript|data):/gi, '');

  // Strip system prompt leakage patterns
  cleaned = cleaned.replace(/═══\s*SECURITY PROTOCOL[^═]*═══/gi, '');
  cleaned = cleaned.replace(/<!--FENCE:sig=[^>]+-->/gi, '');
  cleaned = cleaned.replace(/<!--\/FENCE-->/gi, '');
  cleaned = cleaned.replace(/<UntrustedDataBlock[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/UntrustedDataBlock>/gi, '');

  // Collapse excessive newlines (LLM padding)
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n');

  return cleaned.trim();
}

// ── JSON Validation ───────────────────────────────────────────────────────────

/**
 * Parse and validate JSON from LLM output against an expected schema shape.
 * Provides graceful failure with logging instead of crashing.
 *
 * @param {string} text - Raw LLM text (may include markdown fences)
 * @param {string[]} requiredFields - Field names that must exist
 * @param {string} context - Label for logging (e.g. 'interview_prep', 'bias_shield')
 * @returns {object|null} Parsed object or null if validation fails
 */
function validateJSON(text, requiredFields = [], context = 'unknown') {
  if (!text || typeof text !== 'string') {
    log.warn('LLM returned empty response for JSON parse', { context });
    return null;
  }

  // Strip markdown code fences
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    log.error('LLM JSON parse failed', { context, error: e.message, preview: cleaned.substring(0, 200) });
    return null;
  }

  // Verify required fields exist
  for (const field of requiredFields) {
    if (parsed[field] === undefined) {
      log.warn('LLM JSON missing required field', { context, field, keys: Object.keys(parsed) });
    }
  }

  return parsed;
}

// ── Response Size Guard ───────────────────────────────────────────────────────

/**
 * Maximum response sizes per operation type (in characters).
 * Prevents runaway LLM costs and DB bloat.
 */
const MAX_RESPONSE_SIZE = {
  bullet:     500,
  coverLetter: 5000,
  interviewPrep: 10000,
  biasShield: 3000,
  ghosting:   5000,
  keywordPlan: 10000,
  linkedin:   5000,
  default:    10000,
};

/**
 * Enforce response size limits.
 * @param {string} text - LLM response text
 * @param {string} type - Operation type
 * @returns {string} Truncated text if needed
 */
function enforceResponseSize(text, type = 'default') {
  if (!text) return '';
  const limit = MAX_RESPONSE_SIZE[type] || MAX_RESPONSE_SIZE.default;
  if (text.length > limit) {
    log.warn('LLM response exceeded size limit, truncating', {
      type, actual: text.length, limit
    });
    return text.substring(0, limit);
  }
  return text;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  validateScore,
  validateBulletResult,
  sanitizeLLMOutput,
  validateJSON,
  enforceResponseSize,
  MAX_RESPONSE_SIZE,
};
