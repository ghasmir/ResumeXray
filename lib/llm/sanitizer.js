/**
 * LLM Input Sanitizer — Defense Against Prompt Injection
 *
 * This module runs BEFORE any user-provided text (resume, job description)
 * is sent to the LLM provider. It defends against:
 *
 *  1. Prompt Injection (OWASP LLM01:2025)
 *     - Hidden instructions embedded in resume PDFs (white-on-white text)
 *     - System prompt override attempts
 *     - Instruction delimiters from other LLM frameworks
 *
 *  2. Data Exfiltration Payloads
 *     - Base64-encoded instruction blocks
 *     - Unicode obfuscation (zero-width chars, RTL overrides)
 *     - URL-encoded payloads
 *
 * Architecture:
 *   This is the FIRST layer of a dual-pipeline defense:
 *     Layer 1 (this module): Sanitize input BEFORE LLM sees it
 *     Layer 2 (llm-service.js): Validate LLM output against strict JSON schema
 *
 * Usage:
 *   const { sanitizeForLLM, detectInjectionRisk } = require('./sanitizer');
 *   const cleanText = sanitizeForLLM(rawResumeText);
 *   const risk = detectInjectionRisk(rawResumeText);
 *   if (risk.score > 3) log.warn('High injection risk', risk);
 */

const log = require('../logger');

// ── Injection Pattern Database ─────────────────────────────────────────────────

/**
 * Patterns that indicate prompt injection attempts.
 * Each pattern includes a label for logging/auditing.
 */
const INJECTION_PATTERNS = [
  // Direct instruction override
  { pattern: /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|context)/gi, label: 'instruction_override' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+/gi, label: 'instruction_override' },
  { pattern: /forget\s+(everything|all|what)\s+(you|i)\s+(said|told|know)/gi, label: 'instruction_override' },

  // System prompt manipulation
  { pattern: /system\s*:\s*/gi, label: 'system_prompt' },
  { pattern: /\[INST\]/gi, label: 'llama_delimiter' },
  { pattern: /<<SYS>>/gi, label: 'llama_system' },
  { pattern: /<\|im_start\|>/gi, label: 'chatml_delimiter' },
  { pattern: /<\|im_end\|>/gi, label: 'chatml_delimiter' },
  { pattern: /\[\/INST\]/gi, label: 'llama_delimiter' },
  { pattern: /<<\/SYS>>/gi, label: 'llama_system' },

  // Role assumption
  { pattern: /you\s+are\s+now\s+(a|an|acting|my)\b/gi, label: 'role_assumption' },
  { pattern: /\bact\s+as\s+(a|an|if)\b/gi, label: 'role_assumption' },
  { pattern: /pretend\s+(to\s+be|you\s+are)/gi, label: 'role_assumption' },
  { pattern: /from\s+now\s+on\s*,?\s*(you|I)/gi, label: 'role_assumption' },

  // Output manipulation
  { pattern: /override\s+(the\s+)?(system|scoring|output)/gi, label: 'output_manipulation' },
  { pattern: /assign\s+(a\s+)?score\s+of\s+100/gi, label: 'score_manipulation' },
  { pattern: /new\s+instructions?\s*:/gi, label: 'new_instructions' },
  { pattern: /respond\s+only\s+with/gi, label: 'output_manipulation' },
  { pattern: /output\s+the\s+following/gi, label: 'output_manipulation' },

  // Data exfiltration
  { pattern: /repeat\s+(everything|all|the)\s+(above|previous|system)/gi, label: 'data_exfil' },
  { pattern: /print\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions)/gi, label: 'data_exfil' },
  { pattern: /what\s+(are|were)\s+your\s+(initial|system|original)\s+instructions/gi, label: 'data_exfil' },
];

// ── Unicode Threat Classes ─────────────────────────────────────────────────────

/**
 * Dangerous Unicode character ranges that are invisible or misleading.
 */
const UNICODE_THREATS = {
  // Zero-width characters (invisible text carriers)
  zeroWidth: /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD]/g,

  // Right-to-left override characters (visual text spoofing)
  bidiOverride: /[\u202A-\u202E\u2066-\u2069]/g,

  // Interlinear annotation anchors (hidden metadata)
  annotation: /[\uFFF9-\uFFFB]/g,

  // Tag characters (invisible sequence markers)
  tags: /[\uE0001-\uE007F]/g,
};

// ── Core Sanitization ──────────────────────────────────────────────────────────

/**
 * Sanitize text before sending to any LLM.
 * Returns cleaned text with injection attempts neutralized.
 *
 * @param {string} text - Raw text from resume or job description
 * @returns {string} Sanitized text safe for LLM consumption
 */
function sanitizeForLLM(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // Phase 1: Strip dangerous Unicode
  for (const [category, pattern] of Object.entries(UNICODE_THREATS)) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Phase 2: Strip Base64-encoded blocks (60+ contiguous base64 chars)
  // Attackers embed instructions in Base64 hoping the LLM will decode them
  cleaned = cleaned.replace(/[A-Za-z0-9+/]{60,}={0,2}/g, '[FILTERED_ENCODING]');

  // Phase 3: Collapse excessive whitespace (hidden text technique)
  // Multiple spaces/tabs between words can hide instructions
  cleaned = cleaned.replace(/[ \t]{10,}/g, ' ');

  // Phase 4: Neutralize injection patterns
  for (const { pattern, label } of INJECTION_PATTERNS) {
    // Reset lastIndex for sticky regexes
    pattern.lastIndex = 0;
    if (pattern.test(cleaned)) {
      pattern.lastIndex = 0;
      cleaned = cleaned.replace(pattern, `[FILTERED:${label}]`);
    }
  }

  // Phase 5: Strip HTML/XML-like tags that aren't part of resume content
  // (attackers may use tags like <system> or <instruction>)
  cleaned = cleaned.replace(/<\s*\/?\s*(system|instruction|prompt|override|admin|root)\s*\/?>/gi, '[FILTERED:tag]');

  return cleaned.trim();
}

// ── Risk Detection (Non-Destructive) ──────────────────────────────────────────

/**
 * Analyze text for injection risk WITHOUT modifying it.
 * Returns a risk assessment for logging and monitoring.
 *
 * @param {string} text - Raw text to analyze
 * @returns {{ risk: boolean, score: number, flags: string[] }}
 */
function detectInjectionRisk(text) {
  if (!text || typeof text !== 'string') {
    return { risk: false, score: 0, flags: [] };
  }

  const flags = [];

  // Check for injection patterns
  for (const { pattern, label } of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      flags.push(label);
    }
  }

  // Check for unusual Unicode concentration
  let invisibleCount = 0;
  for (const pattern of Object.values(UNICODE_THREATS)) {
    const matches = text.match(pattern);
    if (matches) invisibleCount += matches.length;
  }
  if (invisibleCount > 5) {
    flags.push(`invisible_chars:${invisibleCount}`);
  }

  // Check for Base64 blocks
  const b64Matches = text.match(/[A-Za-z0-9+/]{60,}={0,2}/g);
  if (b64Matches && b64Matches.length > 0) {
    flags.push(`base64_blocks:${b64Matches.length}`);
  }

  // Check for excessive whitespace (hidden text)
  const excessiveSpaces = text.match(/[ \t]{20,}/g);
  if (excessiveSpaces) {
    flags.push(`hidden_whitespace:${excessiveSpaces.length}`);
  }

  const score = flags.length;
  return {
    risk: score > 0,
    score,
    flags: [...new Set(flags)], // Deduplicate
  };
}

// ── Layer 2: Cryptographic Prompt Fencing (Phase 5 §2) ────────────────────────
// Re-export fence functions so consumers have a single import point
const { fenceUserContent, verifyFence, getFenceInstruction } = require('./prompt-fence');

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  // Layer 1: Regex sanitization
  sanitizeForLLM,
  detectInjectionRisk,
  // Layer 2: Ed25519 cryptographic fencing
  fenceUserContent,
  verifyFence,
  getFenceInstruction,
};
