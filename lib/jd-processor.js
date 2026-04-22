/**
 * Shared JD Processing Helper — backend-owned job context contract.
 * Used by: routes/agent.js (streaming flow), routes/api.js (legacy analyze)
 *
 * Responsibilities:
 * - Accept pasted JD text and/or a job URL
 * - Scrape supported job boards when possible
 * - Derive company, role, ATS platform, and render policy server-side
 * - Return a normalized jobContext object that survives through scan history,
 *   preview, export, and cover-letter generation
 */

const { getJobDescription } = require('./scraper');
const { sanitizeInput } = require('../config/security');
const log = require('./logger');

const AGGREGATOR_HOST_PATTERNS = [
  /(^|\.)indeed\./i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)glassdoor\./i,
  /(^|\.)naukri\./i,
  /(^|\.)monster\./i,
  /(^|\.)ziprecruiter\./i,
  /(^|\.)jobsora\./i,
];

const INVALID_JOB_TITLE_PATTERNS = [
  /^full job description$/i,
  /^job description$/i,
  /^role description$/i,
  /^job overview$/i,
  /^ats-optimized$/i,
  /^target role pending$/i,
  /^target job pending$/i,
  /^title$/i,
  /^role$/i,
];

const INVALID_COMPANY_PATTERNS = [
  /^ats-optimized$/i,
  /^target company pending$/i,
  /^company pending$/i,
  /^company$/i,
  /^employer$/i,
  /^full job description$/i,
];

function normalizeComparableValue(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHostname(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./, '').toLowerCase();
  }
}

function isAggregatorHostname(value = '') {
  const host = parseHostname(value);
  return !!host && AGGREGATOR_HOST_PATTERNS.some(pattern => pattern.test(host));
}

function sanitizeJobTitleValue(value = '') {
  const clean = cleanExtractedValue(value);
  if (!clean) return '';
  if (INVALID_JOB_TITLE_PATTERNS.some(pattern => pattern.test(clean))) return '';
  if (/^(responsibilities|requirements|benefits|salary|department|source|portal)$/i.test(clean)) {
    return '';
  }
  return clean;
}

function sanitizeCompanyNameValue(value = '') {
  const clean = cleanExtractedValue(value);
  if (!clean) return '';
  if (INVALID_COMPANY_PATTERNS.some(pattern => pattern.test(clean))) return '';
  if (isAggregatorHostname(clean)) return '';
  return clean;
}

const ATS_PROFILES = {
  workday: {
    name: 'workday',
    displayName: 'Workday',
    template: 'classic',
    defaultDensity: 'standard',
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
    template: 'refined',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: false,
    urlPatterns: [/greenhouse\.io/i, /boards\.greenhouse\.io/i],
    textSignals: [/greenhouse/i],
  },
  lever: {
    name: 'lever',
    displayName: 'Lever',
    template: 'refined',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/lever\.co/i, /jobs\.lever\.co/i],
    textSignals: [/lever/i],
  },
  linkedin: {
    name: 'linkedin',
    displayName: 'LinkedIn',
    template: 'refined',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: false,
    urlPatterns: [/linkedin\.com\/jobs/i],
    textSignals: [/apply.*linkedin/i, /linkedin/i],
  },
  indeed: {
    name: 'indeed',
    displayName: 'Indeed',
    template: 'refined',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: false,
    urlPatterns: [/indeed\.com/i],
    textSignals: [/indeed/i],
  },
  icims: {
    name: 'icims',
    displayName: 'iCIMS',
    template: 'classic',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/icims\.com/i, /careers\.icims\.com/i],
    textSignals: [/icims/i],
  },
  smartrecruiters: {
    name: 'smartrecruiters',
    displayName: 'SmartRecruiters',
    template: 'refined',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: false,
    urlPatterns: [/smartrecruiters\.com/i, /jobs\.smartrecruiters\.com/i],
    textSignals: [/smartrecruiters/i],
  },
  taleo: {
    name: 'taleo',
    displayName: 'Taleo (Oracle)',
    template: 'classic',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/taleo\.net/i, /oracle.*taleo/i],
    textSignals: [/taleo/i, /oracle.*careers/i],
  },
  bamboohr: {
    name: 'bamboohr',
    displayName: 'BambooHR',
    template: 'refined',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: false,
    strictDates: false,
    urlPatterns: [/bamboohr\.com/i],
    textSignals: [/bamboohr/i],
  },
  cezannehr: {
    name: 'cezannehr',
    displayName: 'Cezanne HR',
    template: 'classic',
    defaultDensity: 'standard',
    singleColumn: true,
    noTables: true,
    strictHeaders: true,
    strictDates: true,
    urlPatterns: [/cezannehr\.com/i],
    textSignals: [/cezanne/i],
  },
};

const DEFAULT_ATS_PROFILE = {
  name: 'generic',
  displayName: 'ATS-Optimized',
  template: 'refined',
  defaultDensity: 'standard',
  singleColumn: true,
  noTables: true,
  strictHeaders: true,
  strictDates: true,
};

const ATS_PLATFORM_ALIASES = Object.freeze({
  Workday: 'workday',
  Greenhouse: 'greenhouse',
  Lever: 'lever',
  LinkedIn: 'linkedin',
  Indeed: 'indeed',
  iCIMS: 'icims',
  SmartRecruiters: 'smartrecruiters',
  BambooHR: 'bamboohr',
  Taleo: 'taleo',
  CezanneHR: 'cezannehr',
  Cezanne: 'cezannehr',
});

function toTitleCase(value = '') {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cleanSlug(value = '') {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanExtractedValue(value = '', maxLength = 120) {
  const cleaned = sanitizeInput(String(value || '').replace(/\s+/g, ' ').trim());
  return cleaned.substring(0, maxLength);
}

function serializeTemplateProfile(atsProfile = DEFAULT_ATS_PROFILE) {
  return {
    template: atsProfile.template,
    defaultDensity: atsProfile.defaultDensity || 'standard',
    singleColumn: !!atsProfile.singleColumn,
    noTables: atsProfile.noTables !== false,
    strictHeaders: !!atsProfile.strictHeaders,
    strictDates: !!atsProfile.strictDates,
  };
}

function hydrateAtsProfile(profileLike = {}) {
  const lookupName = (profileLike.name || profileLike.atsPlatform || '').toLowerCase();
  const base = ATS_PROFILES[lookupName] || DEFAULT_ATS_PROFILE;
  return {
    ...base,
    ...profileLike,
    template: profileLike.template || profileLike.templateProfile?.template || base.template,
    defaultDensity:
      profileLike.defaultDensity ||
      profileLike.templateProfile?.defaultDensity ||
      base.defaultDensity,
    singleColumn:
      profileLike.singleColumn ??
      profileLike.templateProfile?.singleColumn ??
      base.singleColumn,
    noTables:
      profileLike.noTables ??
      profileLike.templateProfile?.noTables ??
      base.noTables,
    strictHeaders:
      profileLike.strictHeaders ??
      profileLike.templateProfile?.strictHeaders ??
      base.strictHeaders,
    strictDates:
      profileLike.strictDates ??
      profileLike.templateProfile?.strictDates ??
      base.strictDates,
  };
}

function detectATS(jobUrl = '', jdText = '', scrapePlatform = '') {
  const searchUrl = String(jobUrl || '').toLowerCase();
  const searchText = String(jdText || '')
    .toLowerCase()
    .substring(0, 4000);
  const normalizedPlatform = ATS_PLATFORM_ALIASES[scrapePlatform] || String(scrapePlatform || '').toLowerCase();

  if (normalizedPlatform && ATS_PROFILES[normalizedPlatform]) {
    return ATS_PROFILES[normalizedPlatform];
  }

  for (const profile of Object.values(ATS_PROFILES)) {
    if (searchUrl && profile.urlPatterns.some(pattern => pattern.test(searchUrl))) {
      log.info('ATS detected from URL', { ats: profile.name, url: jobUrl });
      return profile;
    }
    if (searchText && profile.textSignals.some(pattern => pattern.test(searchText))) {
      log.info('ATS detected from JD text', { ats: profile.name });
      return profile;
    }
  }

  return DEFAULT_ATS_PROFILE;
}

function extractCompanyFromUrl(jobUrl = '') {
  try {
    const url = new URL(jobUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);

    const greenhouseMatch =
      /^(?:boards\.)?greenhouse\.io$/.test(host) && segments[0] ? segments[0] : '';
    if (greenhouseMatch) return toTitleCase(cleanSlug(greenhouseMatch));

    if ((host === 'lever.co' || host.endsWith('.lever.co')) && segments[0]) {
      return toTitleCase(cleanSlug(segments[0]));
    }

    const workdayMatch = host.match(/^([a-z0-9-]+)\.(?:wd\d+\.myworkdayjobs|workday)\.com$/);
    if (workdayMatch?.[1]) return toTitleCase(cleanSlug(workdayMatch[1]));

    if (host === 'jobs.smartrecruiters.com' && segments[0]) {
      return cleanSlug(segments[0].replace(/([A-Z])/g, ' $1')).trim();
    }

    const icimsMatch = host.match(/^([a-z0-9-]+)\.icims\.com$/);
    if (icimsMatch?.[1]) return toTitleCase(cleanSlug(icimsMatch[1]));

    if (host === 'jobs.ashbyhq.com' && segments[0]) {
      return toTitleCase(cleanSlug(segments[0]));
    }

    if (host.includes('linkedin.com')) {
      const slug = segments[segments.length - 1] || '';
      const cleanLinkedinSlug = slug.replace(/-?\d{7,}$/, '').trim();
      const atIndex = cleanLinkedinSlug.lastIndexOf('-at-');
      if (atIndex !== -1) {
        return toTitleCase(cleanSlug(cleanLinkedinSlug.slice(atIndex + 4)));
      }
    }

    if (
      host.includes('indeed.com') ||
      host.includes('glassdoor.com') ||
      host.includes('naukri.com') ||
      host.includes('linkedin.com') ||
      host.includes('cezannehr.com')
    ) {
      return '';
    }

    const parts = host.split('.');
    const registrable = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return registrable ? toTitleCase(cleanSlug(registrable)) : '';
  } catch {
    return '';
  }
}

function extractTitleFromUrl(jobUrl = '') {
  try {
    const url = new URL(jobUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';

    if (host.includes('linkedin.com')) {
      const cleanLinkedinSlug = lastSegment.replace(/-?\d{7,}$/, '').trim();
      const atIndex = cleanLinkedinSlug.lastIndexOf('-at-');
      if (atIndex !== -1) {
        return toTitleCase(cleanSlug(cleanLinkedinSlug.slice(0, atIndex)));
      }
    }

    if ((host === 'lever.co' || host.endsWith('.lever.co')) && segments[1]) {
      return toTitleCase(cleanSlug(segments[1]));
    }

    if (/greenhouse\.io$/.test(host) && segments.includes('jobs')) {
      const jobsIndex = segments.indexOf('jobs');
      if (segments[jobsIndex + 1]) return toTitleCase(cleanSlug(segments[jobsIndex + 1]));
    }

    if (host.includes('smartrecruiters.com') && segments[1]) {
      return toTitleCase(cleanSlug(segments[1]));
    }

    if (lastSegment) {
      const cleaned = cleanSlug(lastSegment.replace(/_[A-Za-z0-9-]+$/, ''));
      if (cleaned && !/^\d+$/.test(cleaned)) return toTitleCase(cleaned);
    }
  } catch {
    return '';
  }
  return '';
}

function isLikelyJobTitleLine(line = '') {
  const clean = sanitizeJobTitleValue(cleanExtractedValue(line, 90));
  if (!clean) return false;
  if (/@|https?:\/\/|www\.|^\d+$/.test(clean)) return false;
  if (
    /^(about|overview|company|summary|responsibilities|requirements|description|benefits|salary|location|department|source|portal|posted|employment type|full job description|job description|the successful candidate will have)\b/i.test(
      clean
    )
  ) {
    return false;
  }
  if (/[.?!;:]$/.test(clean)) return false;

  const words = clean.split(/\s+/);
  if (words.length < 2 || words.length > 8) return false;
  if (
    /(must|will|should|provide|ensure|maintain|support|responsible|required|preferred|using)\b/i.test(
      clean
    ) &&
    words.length > 4
  ) {
    return false;
  }

  const lowerStarts = words.filter(word => /^[a-z]/.test(word));
  if (lowerStarts.length > 2) return false;

  return (
    /^[A-Z]/.test(clean) ||
    /(engineer|developer|manager|analyst|scientist|architect|designer|consultant|specialist|administrator|intern|lead|director|officer|associate|executive|advisor|representative|store)/i.test(
      clean
    )
  );
}

function extractJobTitleFromText(jdText = '') {
  const patterns = [
    /^\s*Job Title:\s*([^\n]+)/im,
    /^\s*Title:\s*([^\n]+)/im,
    /^\s*Position:\s*([^\n]+)/im,
    /^\s*Role:\s*([^\n]+)/im,
    /\bwe\s+(?:require|are seeking|are looking for|seek)\s+(?:an?\s+)?(?:experienced\s+|motivated\s+|driven\s+|ambitious\s+|talented\s+|customer-focused\s+)?([A-Z][A-Za-z/&' -]{2,80}?)\s+(?:to join|for|who|with|in)\b/im,
    /\bjoin\s+(?:our\s+team\s+as\s+)?(?:an?\s+)?([A-Z][A-Za-z/&' -]{2,80}?)\b/im,
  ];

  for (const pattern of patterns) {
    const match = jdText.match(pattern);
    if (match?.[1]) {
      const title = sanitizeJobTitleValue(match[1]);
      if (title) return title;
    }
  }

  const lines = jdText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.length <= 120);

  for (const line of lines.slice(0, 12)) {
    if (isLikelyJobTitleLine(line)) {
      const title = sanitizeJobTitleValue(line);
      if (title) return title;
    }
  }

  return '';
}

function extractCompanyFromText(jdText = '', jobTitle = '') {
  const patterns = [
    /^\s*Company:\s*([^\n]+)/im,
    /^\s*Organization:\s*([^\n]+)/im,
    /^\s*Employer:\s*([^\n]+)/im,
    /^\s*About\s+([A-Z][A-Za-z0-9&.,' -]{2,60})\s*$/m,
    /^\s*([A-Z][A-Za-z0-9&.,' -]{2,80})\s+are\b/m,
    /^\s*([A-Z][A-Za-z0-9&.,' -]{2,80})\s+is\b/m,
    /^\s*At\s+([A-Z][A-Za-z0-9&.,' -]{2,80})\b/m,
    /^\s*Join\s+([A-Z][A-Za-z0-9&.,' -]{2,80})\b/m,
  ];

  for (const pattern of patterns) {
    const match = jdText.match(pattern);
    if (match?.[1]) {
      const company = sanitizeCompanyNameValue(match[1]);
      if (company) return company;
    }
  }

  const titleMatch = String(jobTitle || '').match(/^(.*?)\s+at\s+(.+)$/i);
  if (titleMatch?.[2]) {
    const company = sanitizeCompanyNameValue(titleMatch[2]);
    if (company) return company;
  }

  return '';
}

function fallbackHostname(jobUrl = '') {
  try {
    const host = new URL(jobUrl).hostname.replace(/^www\./, '');
    return isAggregatorHostname(host) ? '' : host;
  } catch {
    return '';
  }
}

function classifyScrapeStatus(errorMessage = '') {
  const lower = String(errorMessage || '').toLowerCase();
  if (
    lower.includes('anti-bot') ||
    lower.includes('cloudflare') ||
    lower.includes('authentication') ||
    lower.includes('login') ||
    lower.includes('blocked')
  ) {
    return 'blocked';
  }
  return 'failed';
}

function normalizeJobContext(jobContext = {}) {
  const atsProfile = hydrateAtsProfile({
    name: jobContext.atsPlatform || jobContext.atsProfile?.name,
    displayName: jobContext.atsDisplayName || jobContext.atsProfile?.displayName,
    templateProfile: jobContext.templateProfile,
  });

  return {
    jobUrl: sanitizeInput(jobContext.jobUrl || ''),
    jobTitle: sanitizeInput(sanitizeJobTitleValue(jobContext.jobTitle || '')),
    companyName: sanitizeInput(sanitizeCompanyNameValue(jobContext.companyName || '')),
    jdText: sanitizeInput(jobContext.jdText || ''),
    jdSource: sanitizeInput(jobContext.jdSource || 'none'),
    scrapeStatus: sanitizeInput(jobContext.scrapeStatus || 'not_requested'),
    scrapeError: sanitizeInput(jobContext.scrapeError || ''),
    atsPlatform: sanitizeInput(jobContext.atsPlatform || atsProfile.name),
    atsDisplayName: sanitizeInput(jobContext.atsDisplayName || atsProfile.displayName),
    templateProfile: serializeTemplateProfile(
      hydrateAtsProfile({
        ...atsProfile,
        ...jobContext.templateProfile,
      })
    ),
  };
}

async function processJobDescription(jdInput, jobTitle = '', jobUrl = '') {
  const safeInput = sanitizeInput(jdInput || '');
  const safeUrl = sanitizeInput(jobUrl || (safeInput.startsWith('http://') || safeInput.startsWith('https://') ? safeInput : ''));
  const pastedJd =
    safeUrl && safeInput && safeInput !== safeUrl ? safeInput : safeUrl ? '' : safeInput;

  const result = {
    jdText: sanitizeInput(pastedJd || ''),
    jobTitle: sanitizeInput(jobTitle || ''),
    jobUrl: safeUrl,
    companyName: '',
    scraped: false,
    scrapeFailed: false,
    atsProfile: DEFAULT_ATS_PROFILE,
    jobContext: normalizeJobContext({
      jobUrl: safeUrl,
      jobTitle,
      jdText: pastedJd,
      jdSource: pastedJd ? 'pasted_text' : 'none',
      scrapeStatus: safeUrl ? 'pending' : 'not_requested',
    }),
  };

  if (!safeInput.trim() && !safeUrl) return result;

  let scrapePlatform = '';
  let scrapeError = '';

  if (safeUrl) {
    try {
      const jdResult = await getJobDescription(safeUrl);
      result.jdText = sanitizeInput(jdResult.text || jdResult || '');
      result.scraped = !!(jdResult.scraped && result.jdText);
      scrapePlatform = jdResult.platform || '';
      const scrapedMeta = jdResult.metadata || {};
      result.jobContext.jdSource = result.scraped ? 'scraped_url' : result.jobContext.jdSource;
      result.jobContext.scrapeStatus = result.scraped ? 'ready' : 'failed';
      result.jobTitle = cleanExtractedValue(scrapedMeta.title || result.jobTitle || '');
      result.companyName = cleanExtractedValue(scrapedMeta.company || result.companyName || '');
    } catch (err) {
      scrapeError = sanitizeInput(err.message || 'Unable to fetch job description.');
      result.scrapeFailed = true;
      result.jobContext.scrapeStatus = classifyScrapeStatus(scrapeError);
      result.jobContext.scrapeError = scrapeError;
      if (pastedJd) {
        result.jdText = sanitizeInput(pastedJd);
        result.jobContext.jdSource = 'pasted_fallback';
      } else {
        result.jdText = '';
        result.jobContext.jdSource = 'url_only';
      }
      log.warn('JD extraction failed', {
        url: safeUrl,
        scrapeStatus: result.jobContext.scrapeStatus,
        error: scrapeError,
      });
    }
  }

  const derivedTitle = sanitizeJobTitleValue(
    result.jobTitle ||
      extractJobTitleFromText(result.jdText) ||
      extractTitleFromUrl(safeUrl)
  );

  const derivedCompany = sanitizeCompanyNameValue(
    extractCompanyFromText(result.jdText, derivedTitle) ||
      extractCompanyFromUrl(safeUrl) ||
      fallbackHostname(safeUrl)
  );

  result.jobTitle = sanitizeInput(derivedTitle);
  result.companyName = sanitizeInput(derivedCompany);
  result.atsProfile = detectATS(safeUrl, result.jdText, scrapePlatform);

  result.jobContext = normalizeJobContext({
    jobUrl: safeUrl,
    jobTitle: result.jobTitle,
    companyName: result.companyName,
    jdText: result.jdText,
    jdSource:
      result.jobContext.jdSource ||
      (result.jdText ? 'pasted_text' : safeUrl ? 'url_only' : 'none'),
    scrapeStatus: result.jobContext.scrapeStatus || (safeUrl ? 'ready' : 'not_requested'),
    scrapeError,
    atsPlatform: result.atsProfile.name,
    atsDisplayName: result.atsProfile.displayName,
    templateProfile: serializeTemplateProfile(result.atsProfile),
  });

  return result;
}

module.exports = {
  processJobDescription,
  detectATS,
  ATS_PROFILES,
  DEFAULT_ATS_PROFILE,
  extractCompanyFromUrl,
  extractTitleFromUrl,
  hydrateAtsProfile,
  isAggregatorHostname,
  normalizeJobContext,
  sanitizeCompanyNameValue,
  sanitizeJobTitleValue,
  serializeTemplateProfile,
};
