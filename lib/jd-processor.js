/**
 * Shared JD Processing Helper — DRY extraction
 * Used by: routes/agent.js (agent flow), routes/api.js (legacy analyze)
 *
 * Handles: scraping, sanitization, title extraction from JD text/URL,
 *          and ATS platform detection for adaptive resume generation.
 */

const { getJobDescription } = require('./scraper');
const { sanitizeInput } = require('../config/security');
const log = require('./logger');

// ── ATS Platform Detection ─────────────────────────────────────────────────────
//
// Maps URL patterns and JD text signals to known ATS platforms.
// The atsProfile drives template selection in resume-builder.js:
//   - singleColumn: force single-column layout (Workday, Taleo are strict)
//   - noTables: strip tables from DOCX output
//   - strictHeaders: use only whitelist section headers
//   - strictDates: force MM/YYYY date format
//
const ATS_PROFILES = {
  workday: {
    name: 'workday',
    displayName: 'Workday',
    template: 'minimal',   // Workday: single-column strict parser
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/myworkdayjobs\.com/i, /workday\.com/i, /wd\d+\.myworkdayjobs/i],
    textSignals: [/workday/i, /apply.*workday/i],
  },
  greenhouse: {
    name: 'greenhouse',
    displayName: 'Greenhouse',
    template: 'modern',    // Greenhouse: tolerant, preview-based
    singleColumn: false,
    noTables: true,
    strictHeaders: true,
    strictDates: false,
    urlPatterns: [/greenhouse\.io/i, /boards\.greenhouse\.io/i],
    textSignals: [/greenhouse/i],
  },
  lever: {
    name: 'lever',
    displayName: 'Lever',
    template: 'modern',    // Lever: structured, tolerates 2-col
    singleColumn: false,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/lever\.co/i, /jobs\.lever\.co/i],
    textSignals: [/lever/i],
  },
  icims: {
    name: 'icims',
    displayName: 'iCIMS',
    template: 'classic',   // iCIMS: keyword-heavy, stable parser
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/icims\.com/i, /careers\.icims\.com/i],
    textSignals: [/icims/i],
  },
  taleo: {
    name: 'taleo',
    displayName: 'Taleo (Oracle)',
    template: 'minimal',   // Taleo: rigid, fails on icons/graphics
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/taleo\.net/i, /oracle.*taleo/i],
    textSignals: [/taleo/i, /oracle.*careers/i],
  },
  smartrecruiters: {
    name: 'smartrecruiters',
    displayName: 'SmartRecruiters',
    template: 'modern',    // AI-based parser, tolerant but prefers single-column
    singleColumn: false,
    noTables: true,
    strictHeaders: false,
    strictDates: false,
    urlPatterns: [/smartrecruiters\.com/i, /jobs\.smartrecruiters\.com/i],
    textSignals: [/smartrecruiters/i],
  },
  bamboohr: {
    name: 'bamboohr',
    displayName: 'BambooHR',
    template: 'minimal',   // Lightweight parser, breaks on tables
    singleColumn: true,
    noTables: true,
    strictHeaders: false,
    strictDates: false,
    urlPatterns: [/bamboohr\.com/i],
    textSignals: [/bamboohr/i],
  },
  linkedin: {
    name: 'linkedin',
    displayName: 'LinkedIn',
    template: 'modern',    // Autofill from body, tolerant
    singleColumn: false,
    noTables: false,
    strictHeaders: false,
    strictDates: false,
    urlPatterns: [/linkedin\.com\/jobs/i],
    textSignals: [/apply.*linkedin/i],
  },
};

// Default profile for unknown ATS (safe, broadly compatible)
const DEFAULT_ATS_PROFILE = {
  name: 'generic',
  displayName: 'ATS-Optimized',
  template: 'modern',
  singleColumn: false,
  noTables: true,
  strictHeaders: true,
  strictDates: true,
};

/**
 * Detect the ATS platform from the job URL and/or JD text.
 * Returns the ATS profile object describing formatting constraints.
 *
 * @param {string} jobUrl  - The job posting URL (may be empty)
 * @param {string} jdText  - The scraped/pasted job description text
 * @returns {object} atsProfile
 */
function detectATS(jobUrl = '', jdText = '') {
  const searchUrl = jobUrl.toLowerCase();
  const searchText = (jdText || '').toLowerCase().substring(0, 2000); // Only scan first 2k chars

  for (const [, profile] of Object.entries(ATS_PROFILES)) {
    // URL pattern takes priority (more reliable than text signals)
    if (searchUrl && profile.urlPatterns.some(p => p.test(searchUrl))) {
      log.info('ATS detected from URL', { ats: profile.name, url: jobUrl });
      return profile;
    }
    // Text-based signal fallback (less reliable)
    if (searchText && profile.textSignals.some(p => p.test(searchText))) {
      log.info('ATS detected from JD text', { ats: profile.name });
      return profile;
    }
  }

  return DEFAULT_ATS_PROFILE;
}

/**
 * Process a JD input (URL or raw text) and return structured data including ATS profile.
 *
 * @param {string} jdInput   - Raw JD input from user (URL or pasted text)
 * @param {string} jobTitle  - Optional pre-supplied job title
 * @param {string} jobUrl    - Optional pre-supplied job URL
 * @returns {{ jdText, jobTitle, jobUrl, scraped, scrapeFailed, atsProfile }}
 */
async function processJobDescription(jdInput, jobTitle = '', jobUrl = '') {
  const result = {
    jdText: '',
    jobTitle: sanitizeInput(jobTitle),
    jobUrl: sanitizeInput(jobUrl),
    scraped: false,
    scrapeFailed: false,
    atsProfile: DEFAULT_ATS_PROFILE,
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
    throw new Error(`${err.message} Cloudflare/Security might have blocked us. Please copy and paste the Job Description text manually instead of using the URL.`);
  }

  // Detect ATS from the final URL and text (after scraping)
  result.atsProfile = detectATS(result.jobUrl || safeInput, result.jdText);

  return result;
}

module.exports = { processJobDescription, detectATS, ATS_PROFILES };
