/**
 * LLM Service — Provider-Agnostic AI Layer + Anti-Fluff Humanizer
 * 
 * Factory pattern: reads LLM_PROVIDER env var, returns configured provider.
 * All AI features route through this single module.
 * 
 * ANTI-FLUFF: Every text output passes through the Context Humanizer
 * before returning to the caller. This provides a two-layer defense:
 *   Layer 1: Prompt engineering (ban list injected into system prompts)
 *   Layer 2: Post-processing (humanizer.js strips anything that slipped through)
 * 
 * To swap providers: change LLM_PROVIDER in .env (openai | gemini)
 * No other code changes needed.
 * 
 * Hybrid model strategy:
 *   - 'fast' model: Extraction, analysis, mapping (gpt-4o-mini / gemini-flash)
 *   - 'premium' model: CAR bullet rewrites, cover letters (gpt-4o / gemini-pro)
 */

const log = require('../logger');
const { validateScore, validateBulletResult, sanitizeLLMOutput, validateJSON, enforceResponseSize } = require('./output-validator');

// ── Phase 3 #14: LLM Request Queue + Exponential Backoff ─────────────────────

const LLM_MAX_CONCURRENCY = parseInt(process.env.LLM_MAX_CONCURRENCY || '8', 10);

/**
 * Exponential backoff retry for LLM API calls.
 * Retries on 429 (rate limit) and 5xx (server errors), with jitter.
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e?.status || e?.response?.status || 0;
      const isRetryable = status === 429 || status >= 500;
      
      if (isRetryable && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        log.warn('LLM request failed, retrying', {
          attempt: attempt + 1,
          maxRetries,
          status,
          delayMs: Math.round(delay),
        });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
}

// Phase 6 Wave 3: Per-call timeout wrapper — prevents runaway LLM costs
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '45000', 10);

function withTimeout(promise, timeoutMs = LLM_TIMEOUT_MS, label = 'LLM call') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Simple concurrency-limited task queue for LLM requests.
 * Prevents overwhelming the LLM provider with too many parallel calls.
 */
class LlmQueue {
  constructor(concurrency = LLM_MAX_CONCURRENCY) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      const task = async () => {
        this.running++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          this._next();
        }
      };

      if (this.running < this.concurrency) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  }

  _next() {
    if (this.queue.length > 0 && this.running < this.concurrency) {
      const task = this.queue.shift();
      task();
    }
  }
}

const llmQueue = new LlmQueue();

// ── Load provider based on env ────────────────────────────────────────────────

function getProvider() {
  const providerName = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
  switch (providerName) {
    case 'openai':
      return require('./providers/openai');
    case 'gemini':
      return require('./providers/gemini');
    default:
      log.warn('Unknown LLM_PROVIDER, falling back to openai', { providerName });
      return require('./providers/openai');
  }
}

// ── Anti-Fluff Humanizer ──────────────────────────────────────────────────────

const { humanizeBulletResult, humanizeText, scanForFluff, auditContextRetention } = require('./humanizer');

// ── Prompt templates ──────────────────────────────────────────────────────────

const { buildBulletRewritePrompt, buildSimpleBulletRewritePrompt } = require('./prompts/bullet-rewrite');
const { buildCoverLetterPrompt } = require('./prompts/cover-letter');
const { buildInterviewPrepPrompt } = require('./prompts/interview-prep');
// Semantic match now uses embeddings (see computeEmbeddingScore below)
const { buildBiasShieldPrompt } = require('./prompts/bias-shield');
const { buildGhostingKnockoutPrompt } = require('./prompts/ghosting-knockout');
const { buildKeywordPlanPrompt } = require('./prompts/keyword-plan');
const { buildLinkedInPrompt } = require('./prompts/linkedin');

// ── Embedding-Based Semantic Scoring ─────────────────────────────────────────

const crypto = require('crypto');
const embeddingCache = new Map();
const EMBEDDING_CACHE_MAX = 500; // ~3MB at 1536 dimensions (float64)

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function calibrateScore(raw) {
  // Maps cosine similarity [0.30, 0.80] → [0, 100]
  // Empirical range: unrelated ~0.29, wrong-field ~0.32, strong match ~0.75
  const floor = 0.30;
  const ceiling = 0.80;
  const normalized = (raw - floor) / (ceiling - floor);
  return Math.round(Math.max(0, Math.min(100, normalized * 100)));
}

async function getEmbedding(text) {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  if (embeddingCache.has(hash)) {
    // Move to end for LRU ordering (Map preserves insertion order)
    const cached = embeddingCache.get(hash);
    embeddingCache.delete(hash);
    embeddingCache.set(hash, cached);
    return cached;
  }
  const provider = getProvider();
  // Phase 3 #14: Queue + retry for embedding calls
  const vector = await llmQueue.add(() => withRetry(() => provider.embed(text)));
  // LRU eviction: remove oldest entry if cache is full
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    const oldest = embeddingCache.keys().next().value;
    embeddingCache.delete(oldest);
  }
  embeddingCache.set(hash, vector);
  return vector;
}

async function computeEmbeddingScore(resumeText, jdText) {
  const [resumeVec, jdVec] = await Promise.all([
    getEmbedding(resumeText),
    getEmbedding(jdText),
  ]);
  return calibrateScore(cosineSimilarity(resumeVec, jdVec));
}

// ── Utility: Parse JSON from LLM output ───────────────────────────────────────

function parseJsonFromLLM(text) {
  let cleaned = text.trim();
  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  // Strip leading/trailing quotes
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  return JSON.parse(cleaned);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Simple bullet rewrite (non-streaming, returns string).
 * → Humanized: ban list + filler removal applied.
 */
async function rewriteBulletPoint(originalText, jobDescription = '') {
  const provider = getProvider();
  const config = buildSimpleBulletRewritePrompt(originalText, jobDescription);
  // Phase 3 #14: Queue + retry + Phase 6 Wave 3: timeout
  const result = await llmQueue.add(() => withTimeout(
    withRetry(() => provider.generate(config.prompt, {
      systemPrompt: config.systemPrompt,
      model: config.model,
    })),
    LLM_TIMEOUT_MS,
    'rewriteBulletPoint'
  ));
  // Anti-fluff: humanize the raw output
  const humanized = humanizeText(result.replace(/^["']|["']$/g, '').trim());
  // Phase 6 Wave 3: Output sanitization + size guard
  return enforceResponseSize(sanitizeLLMOutput(humanized), 'bullet');
}

/**
 * CAR formula bullet rewrite (non-streaming, returns object).
 * → Humanized: ban list + context audit applied.
 */
async function rewriteBulletWithCAR(bulletText, jobDescription = '') {
  const provider = getProvider();
  const config = buildBulletRewritePrompt(bulletText, jobDescription);
  
  // Phase 3 #14: Queue + retry for generate calls
  const result = await llmQueue.add(() => withRetry(() => provider.generate(config.prompt, {
    systemPrompt: config.systemPrompt,
    model: config.model,
  })));

  try {
    const parsed = parseJsonFromLLM(result);
    const bulletResult = {
      original: bulletText,
      rewritten: parsed.rewritten || bulletText,
      targetKeyword: parsed.targetKeyword || 'general',
      method: parsed.method || 'Improved impact and metrics',
      needsMetric: parsed.needsMetric || false,
      metricPrompt: parsed.metricPrompt || null,
    };
    // Anti-fluff: humanize + context audit
    const humanized = humanizeBulletResult(bulletResult);
    // Phase 6 Wave 3: Output validation
    return validateBulletResult(humanized);
  } catch (e) {
    log.error('CAR rewrite JSON parse failed', { error: e.message });
    throw new Error('Failed to rewrite bullet point.');
  }
}

/**
 * Stream a CAR bullet rewrite. Calls onToken for live display.
 * → Humanized: post-stream ban list + context audit applied.
 * 
 * Note: During streaming, raw tokens are sent to the UI for live display.
 * The humanizer runs AFTER the full text is collected (the final parsed result
 * is what gets stored/exported). The UI updates the display with the clean version.
 */
async function streamBulletRewrite(bulletText, jobDescription, onToken) {
  const provider = getProvider();
  const config = buildBulletRewritePrompt(bulletText, jobDescription);

  // Phase 3 #14: Retry for streaming calls
  const fullText = await withRetry(() => provider.stream(config.prompt, onToken, {
    systemPrompt: config.systemPrompt,
    model: config.model,
  }));

  try {
    const parsed = parseJsonFromLLM(fullText);
    const bulletResult = {
      original: bulletText,
      rewritten: parsed.rewritten || bulletText,
      targetKeyword: parsed.targetKeyword || 'general',
      method: parsed.method || 'Improved impact and metrics',
      needsMetric: parsed.needsMetric || false,
      metricPrompt: parsed.metricPrompt || null,
    };
    // Anti-fluff: humanize + context audit (runs on final text)
    return humanizeBulletResult(bulletResult);
  } catch (e) {
    // Fallback: treat full text as the rewritten bullet, still humanize
    const bulletResult = {
      original: bulletText,
      rewritten: humanizeText(fullText.replace(/^["']|["']$/g, '')),
      targetKeyword: 'general',
      method: 'AI-optimized rewrite',
    };
    bulletResult.contextAudit = auditContextRetention(bulletText, bulletResult.rewritten);
    return bulletResult;
  }
}

/**
 * Stream a tailored cover letter.
 * → Humanized: ban list + filler removal applied to full text AFTER stream.
 */
async function streamCoverLetter(resumeText, jobDescription, onToken) {
  const provider = getProvider();
  const config = buildCoverLetterPrompt(resumeText, jobDescription);
  
  // Phase 3 #14: Retry for streaming calls
  const fullText = await withRetry(() => provider.stream(config.prompt, onToken, {
    systemPrompt: config.systemPrompt,
    model: config.model,
  }));

  return enforceResponseSize(humanizeText(fullText), 'coverLetter');
}

/**
 * Generate a tailored cover letter.
 * → Humanized: ban list + filler removal applied to full text.
 */
async function generateCoverLetter(resumeText, jobDescription) {
  const provider = getProvider();
  const config = buildCoverLetterPrompt(resumeText, jobDescription);
  // Phase 3 #14: Queue + retry
  const result = await llmQueue.add(() => withRetry(() => provider.generate(config.prompt, {
    systemPrompt: config.systemPrompt,
    model: config.model,
  })));
  // Anti-fluff: humanize the cover letter text + Phase 6 Wave 3: size guard
  return enforceResponseSize(humanizeText(result), 'coverLetter');
}

/**
 * Generate interview prep questions.
 * → No humanization needed (structured Q&A data, not prose).
 */
async function generateInterviewPrep(resumeText, jobDescription) {
  const provider = getProvider();
  const config = buildInterviewPrepPrompt(resumeText, jobDescription);
  // Phase 3 #14: Queue + retry
  const result = await llmQueue.add(() => withRetry(() => provider.generate(config.prompt, {
    systemPrompt: config.systemPrompt,
    model: config.model,
  })));
  try {
    return parseJsonFromLLM(result);
  } catch (e) {
    log.error('Interview prep JSON parse failed', { error: e.message });
    throw new Error('Failed to generate interview questions.');
  }
}

/**
 * Optimize LinkedIn profile text.
 * → Humanized: ban list + filler removal applied.
 */
async function optimizeLinkedIn(resumeText, linkedinText) {
  const provider = getProvider();
  const config = buildLinkedInPrompt(resumeText, linkedinText);
  // Phase 3 #14: Queue + retry
  const result = await llmQueue.add(() => withRetry(() => provider.generate(config.prompt, {
    systemPrompt: config.systemPrompt,
    model: config.model,
  })));
  return enforceResponseSize(humanizeText(result), 'linkedin');
}

/**
 * Semantic match via embedding cosine similarity.
 * Deterministic, fast, and cheap — no LLM call needed for scoring.
 * Missing skills come from the keyword module instead.
 */
async function analyzeSemanticMatch(resumeText, jobDescription) {
  try {
    const score = await computeEmbeddingScore(resumeText, jobDescription);
    return { score, missing: [], inferred: [] };
  } catch (e) {
    log.error('Embedding semantic match failed', { error: e.message });
    return { score: 0, missing: [], inferred: [] };
  }
}

/**
 * Bias shield analysis.
 * → No humanization needed (structured data).
 */
async function analyzeBiasShield(resumeText) {
  const provider = getProvider();
  const config = buildBiasShieldPrompt(resumeText);
  try {
    // Phase 3 #14: Queue + retry
    const result = await llmQueue.add(() => withRetry(() => provider.generate(config.prompt, {
      systemPrompt: config.systemPrompt,
      model: config.model,
    })));
    return parseJsonFromLLM(result);
  } catch (e) {
    return { riskScore: 0, flags: [] };
  }
}

/**
 * Ghosting & Knockout analysis.
 * → Post-processed: false date flags filtered.
 */
async function analyzeGhostingAndKnockouts(resumeText, jobDescription) {
  const provider = getProvider();
  const config = buildGhostingKnockoutPrompt(resumeText, jobDescription);
  try {
    // Phase 3 #14: Queue + retry
    const result = await llmQueue.add(() => withRetry(() => provider.generate(config.prompt, {
      systemPrompt: config.systemPrompt,
      model: config.model,
    })));
    const parsed = parseJsonFromLLM(result);
    // Post-process: filter false date flags
    if (parsed.knockoutRisks) {
      parsed.knockoutRisks = filterFalseDateFlags(parsed.knockoutRisks);
    }
    return parsed;
  } catch (e) {
    log.error('Ghosting/Knockout analysis failed', { error: e.message });
    return { ghostingBullets: [], knockoutRisks: [] };
  }
}

/**
 * Stream keyword insertion plan.
 * → No humanization needed (structured JSON data).
 */
async function streamKeywordInsertionPlan(resumeText, missingKeywords, onToken) {
  const provider = getProvider();
  const config = buildKeywordPlanPrompt(resumeText, missingKeywords);

  const fullText = await provider.stream(config.prompt, onToken, {
    systemPrompt: config.systemPrompt,
    model: config.model,
  });

  try {
    return parseJsonFromLLM(fullText);
  } catch (e) {
    log.error('Keyword plan parse failed', { error: e.message });
    return [];
  }
}

// ── Post-processing: Filter false date flags ──────────────────────────────────

/**
 * Removes knockout risk entries that falsely flag past dates as "future dates".
 * E.g. if today is March 2026, "February 2026" should NOT be flagged.
 */
function filterFalseDateFlags(knockoutRisks) {
  const now = new Date();
  const futureDatePattern = /(?:future|will|upcoming)\s*(?:date|employment|position|role)/i;
  const dateExtract = /\b(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(\d{4})\b/gi;

  return knockoutRisks.filter(risk => {
    const riskLower = risk.toLowerCase();
    // Only filter risks that mention "future date" concepts
    if (!futureDatePattern.test(riskLower) && !riskLower.includes('future')) {
      return true; // Keep non-date-related risks
    }

    // Extract years from the risk text
    const matches = [...risk.matchAll(dateExtract)];
    for (const match of matches) {
      const year = parseInt(match[1]);
      if (year <= now.getFullYear()) {
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthMatch = risk.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
        if (monthMatch && year === now.getFullYear()) {
          const mentionedMonth = monthNames.findIndex(m => monthMatch[1].startsWith(m));
          if (mentionedMonth >= 0 && mentionedMonth < now.getMonth()) {
            return false; // False flag — this month has already passed
          }
        }
        if (year < now.getFullYear()) {
          return false; // Year is entirely in the past
        }
      }
    }
    return true;
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  rewriteBulletPoint,
  rewriteBulletWithCAR,
  streamBulletRewrite,
  generateCoverLetter,
  streamCoverLetter,
  generateInterviewPrep,
  optimizeLinkedIn,
  analyzeSemanticMatch,
  analyzeBiasShield,
  analyzeGhostingAndKnockouts,
  streamKeywordInsertionPlan,
  // Utilities (exported for testing + UI)
  filterFalseDateFlags,
  scanForFluff,
  computeEmbeddingScore,
};
