/**
 * Shared JD Processing Helper — DRY extraction
 * Used by: routes/agent.js (agent flow), routes/api.js (legacy analyze)
 *
 * Handles: scraping, sanitization, title extraction from JD text/URL
 */

const { getJobDescription } = require('./scraper');
const { sanitizeInput } = require('../config/security');
const log = require('./logger');

/**
 * Process a JD input (URL or raw text) and return structured data.
 * @param {string} jdInput - Raw JD input from user (URL or pasted text)
 * @param {string} [jobTitle] - Optional pre-supplied job title
 * @param {string} [jobUrl] - Optional pre-supplied job URL
 * @returns {{ jdText: string, jobTitle: string, jobUrl: string, scraped: boolean, scrapeFailed: boolean }}
 */
async function processJobDescription(jdInput, jobTitle = '', jobUrl = '') {
  const result = {
    jdText: '',
    jobTitle: sanitizeInput(jobTitle),
    jobUrl: sanitizeInput(jobUrl),
    scraped: false,
    scrapeFailed: false,
  };

  const safeInput = sanitizeInput(jdInput || '');
  if (!safeInput.trim()) return result;

  try {
    const jdResult = await getJobDescription(safeInput);
    result.jdText = sanitizeInput(jdResult.text || jdResult);

    if (jdResult.scraped && result.jdText) {
      result.scraped = true;
      result.jobUrl = safeInput;

      // Auto-derive job title from scraped text or URL hostname
      if (!result.jobTitle) {
        const titleMatch = result.jdText.match(/Job Title:\s*([^\n]+)/i);
        if (titleMatch) {
          result.jobTitle = sanitizeInput(titleMatch[1].trim().substring(0, 100));
        } else {
          try {
            result.jobTitle = new URL(result.jobUrl).hostname.replace(/^www\./, '');
          } catch { /* ignore invalid URL */ }
        }
      }
    }
  } catch (err) {
    log.warn('JD extraction failed', { error: err.message });
    result.scrapeFailed = true;
    // Re-throw with user-friendly message for agent route (caller can catch)
    throw new Error(`${err.message} Cloudflare/Security might have blocked us. Please copy and paste the Job Description text manually instead of using the URL.`);
  }

  return result;
}

module.exports = { processJobDescription };
