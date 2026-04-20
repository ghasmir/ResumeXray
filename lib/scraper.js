// Node.js 22+ has native fetch — no need for node-fetch dependency
const cheerio = require('cheerio');

/**
 * Smart JD Input Handler.
 * Detects whether input is a URL or plain text.
 * For URLs: identifies the platform and uses the best scraping strategy.
 * Returns { text, platform, scraped } or throws with a helpful message.
 */
async function getJobDescription(input) {
  if (!input || !input.trim()) return { text: '', platform: null, scraped: false };

  const trimmed = input.trim();

  // If it's not a URL, it's pasted text — just clean and return
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return { text: cleanText(trimmed), platform: 'pasted', scraped: false };
  }

  // It's a URL — identify the platform
  const url = trimmed;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();

  // §10.x: SSRF protection — block requests to internal/private/localhost targets
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are allowed.');
  }
  const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1?\]|metadata\.google\.internal)$/i;
  if (BLOCKED_HOSTS.test(host)) {
    throw new Error('Requests to internal or private addresses are not allowed.');
  }

  try {
    // ── Workday ──
    if (host.includes('.myworkdayjobs.com') || host.includes('myworkday.com')) {
      return normalizeScrapeResult(await scrapeWorkday(url), 'Workday');
    }
    // ── Greenhouse ──
    if (host.includes('greenhouse.io') || host.includes('boards.greenhouse.io')) {
      return normalizeScrapeResult(await scrapeGreenhouse(url), 'Greenhouse');
    }
    // ── Lever ──
    if (host.includes('lever.co') || host.includes('jobs.lever.co')) {
      return normalizeScrapeResult(await scrapeLever(url), 'Lever');
    }
    // ── LinkedIn ──
    if (host.includes('linkedin.com')) {
      return normalizeScrapeResult(await scrapeLinkedIn(url), 'LinkedIn');
    }
    // ── Indeed ──
    if (host.includes('indeed.com')) {
      return normalizeScrapeResult(await scrapeIndeed(url), 'Indeed');
    }
    // ── Glassdoor ──
    if (host.includes('glassdoor.com') || host.includes('glassdoor.co')) {
      return normalizeScrapeResult(await scrapeGenericHTML(url), 'Glassdoor');
    }
    // ── Naukri ──
    if (host.includes('naukri.com')) {
      return normalizeScrapeResult(await scrapeNaukri(url), 'Naukri');
    }
    // ── iCIMS ──
    if (host.includes('icims.com')) {
      return normalizeScrapeResult(await scrapeGenericHTML(url), 'iCIMS');
    }
    // ── SmartRecruiters ──
    if (host.includes('smartrecruiters.com')) {
      return normalizeScrapeResult(await scrapeSmartRecruiters(url), 'SmartRecruiters');
    }
    // ── Cezanne HR ──
    if (host.includes('cezannehr.com')) {
      return normalizeScrapeResult(await scrapeGenericHTML(url), 'CezanneHR');
    }
    // ── Generic fallback ──
    return normalizeScrapeResult(await scrapeGenericHTML(url), 'generic');

  } catch (err) {
    // Differentiate error types for better user messaging
    const msg = err.message || '';
    if (msg.includes('403') || msg.includes('503') || msg.includes('Cloudflare') || msg.includes('challenge')) {
      throw new Error(`This site (${host}) uses anti-bot protection that blocks automated access. Please copy and paste the job description text directly instead.`);
    }
    if (msg.includes('401') || msg.includes('login') || msg.includes('auth')) {
      throw new Error(`This job listing on ${host} requires authentication. Please copy and paste the job description text instead.`);
    }
    if (msg.includes('TimeoutError') || msg.includes('abort') || msg.includes('ECONNREFUSED')) {
      throw new Error(`Could not reach ${host} — the site may be temporarily unavailable. Please try again or paste the job description text.`);
    }
    throw new Error(`Could not extract from ${host}. Please paste the job description text instead.`);
  }
}

function normalizeScrapeResult(result, platform) {
  const text = typeof result === 'string' ? result : result?.text || '';
  const metadata = {
    ...(typeof result === 'object' && result?.metadata ? result.metadata : {}),
    ...extractMetadataFromText(text),
  };
  return {
    text: cleanText(text),
    platform,
    scraped: true,
    metadata,
  };
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM-SPECIFIC SCRAPERS
// ═══════════════════════════════════════════════════════════════

// User-Agent rotation — cycle through modern browsers to avoid fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];
function getHeaders() {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}
const HEADERS = getHeaders();

// ── Workday ────────────────────────────────────────────────────
async function scrapeWorkday(url) {
  // Strip /apply/ suffix and query params
  let cleanUrl = url.split('?')[0].replace(/\/apply\/.*$/i, '');
  const urlObj = new URL(cleanUrl);
  const hostname = urlObj.hostname;
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  const tenant = hostname.split('.')[0];
  let startIdx = 0;
  if (pathParts[0] && /^[a-z]{2}(-[A-Z]{2})?$/.test(pathParts[0])) startIdx = 1;
  const site = pathParts[startIdx] || '';
  const jobSlug = pathParts[pathParts.length - 1] || '';
  const jobIdMatch = jobSlug.match(/_([A-Za-z0-9-]+)$/);
  const jobReqId = jobIdMatch ? jobIdMatch[1] : jobSlug;

  // Try API endpoint
  const apiUrl = `https://${hostname}/wday/cxs/${tenant}/${site}/job/${jobSlug}`;
  const apiRes = await fetch(apiUrl, { headers: { ...HEADERS, Accept: 'application/json', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });

  if (apiRes.ok) {
    const data = await apiRes.json();
    return parseWorkdayResponse(data, jobReqId);
  }

  // Fallback: full path
  const fullPath = pathParts.slice(startIdx + 1).join('/');
  const altRes = await fetch(`https://${hostname}/wday/cxs/${tenant}/${site}/${fullPath}`, { headers: { ...HEADERS, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (altRes.ok) {
    const data = await altRes.json();
    return parseWorkdayResponse(data, jobReqId);
  }

  throw new Error('Workday API returned no data. This listing may require authentication.');
}

function parseWorkdayResponse(data, jobReqId) {
  const parts = [];
  const title = data.jobPostingInfo?.title || data.title || '';
  if (title) parts.push(`Job Title: ${title}`);
  const location = data.jobPostingInfo?.location || data.location || '';
  if (location) parts.push(`Location: ${location}`);
  if (jobReqId) parts.push(`Requisition ID: ${jobReqId}`);

  const descHtml = data.jobPostingInfo?.jobDescription || data.jobDescription || data.jobPostingInfo?.externalDescription || '';
  if (descHtml) {
    const $ = cheerio.load(descHtml);
    parts.push('\n' + $.text().trim());
  }
  const additional = data.jobPostingInfo?.additionalJobDescriptions || [];
  for (const s of additional) {
    if (s.title) parts.push(`\n${s.title}`);
    if (s.description) { const $ = cheerio.load(s.description); parts.push($.text().trim()); }
  }
  const result = parts.join('\n').trim();
  if (result.length < 50) throw new Error('Insufficient content from Workday API.');
  return cleanText(result);
}

// ── Greenhouse (public API — no auth needed) ──────────────────
async function scrapeGreenhouse(url) {
  const pathParts = new URL(url).pathname.split('/').filter(Boolean);
  // URL format: boards.greenhouse.io/{board_token}/jobs/{id}
  let boardToken = '', jobId = '';

  if (pathParts.includes('jobs')) {
    const jobsIdx = pathParts.indexOf('jobs');
    boardToken = pathParts[jobsIdx - 1] || pathParts[0];
    jobId = pathParts[jobsIdx + 1];
  } else {
    boardToken = pathParts[0];
    jobId = pathParts[pathParts.length - 1];
  }

  if (!boardToken || !jobId) throw new Error('Could not parse Greenhouse URL.');

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}?content=true`;
  const res = await fetch(apiUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Greenhouse API returned ' + res.status);

  const data = await res.json();
  const parts = [];
  if (data.title) parts.push(`Job Title: ${data.title}`);
  if (data.location?.name) parts.push(`Location: ${data.location.name}`);
  if (data.content) {
    const $ = cheerio.load(data.content);
    parts.push('\n' + $.text().trim());
  }
  const result = parts.join('\n').trim();
  if (result.length < 50) throw new Error('Insufficient content from Greenhouse.');
  return cleanText(result);
}

// ── Lever (public API — no auth needed) ───────────────────────
async function scrapeLever(url) {
  const pathParts = new URL(url).pathname.split('/').filter(Boolean);
  // Format: jobs.lever.co/{company}/{jobId}
  const company = pathParts[0];
  const jobId = pathParts[1];

  if (!company || !jobId) throw new Error('Could not parse Lever URL.');

  const apiUrl = `https://api.lever.co/v0/postings/${company}/${jobId}`;
  const res = await fetch(apiUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Lever API returned ' + res.status);

  const data = await res.json();
  const parts = [];
  if (data.text) parts.push(`Job Title: ${data.text}`);
  if (data.categories?.location) parts.push(`Location: ${data.categories.location}`);
  if (data.categories?.team) parts.push(`Team: ${data.categories.team}`);
  if (data.descriptionPlain) parts.push('\n' + data.descriptionPlain);
  if (data.additionalPlain) parts.push('\n' + data.additionalPlain);
  // Lists (e.g. requirements)
  if (data.lists?.length) {
    for (const list of data.lists) {
      if (list.text) parts.push('\n' + list.text);
      if (list.content) { const $ = cheerio.load(list.content); parts.push($.text().trim()); }
    }
  }
  const result = parts.join('\n').trim();
  if (result.length < 50) throw new Error('Insufficient content from Lever.');
  return cleanText(result);
}

// ── LinkedIn ──────────────────────────────────────────────────
async function scrapeLinkedIn(url) {
  // Extract job ID from URL patterns:
  // linkedin.com/jobs/view/1234567890
  // linkedin.com/jobs/view/title-at-company-1234567890
  // linkedin.com/jobs/collections/recommended/.../1234567890
  // linkedin.com/jobs/search/?currentJobId=1234567890
  
  let jobId = null;
  try {
    const urlObj = new URL(url);
    if (urlObj.searchParams.has('currentJobId')) {
      jobId = urlObj.searchParams.get('currentJobId');
    } else if (urlObj.searchParams.has('v2JobPosting')) {
      jobId = urlObj.searchParams.get('v2JobPosting');
    } else {
      const match = urlObj.pathname.match(/(\d{8,})/);
      if (match) jobId = match[1];
    }
  } catch (e) {
    const match = url.match(/(\d{8,})/);
    if (match) jobId = match[1];
  }

  if (!jobId) {
    // If we can't extract an ID, fall back to generic HTML scrape
    return scrapeGenericHTML(url);
  }

  try {
    // LinkedIn guest API — returns HTML fragment of the job posting
    const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
    const res = await fetch(apiUrl, {
      headers: {
        ...HEADERS,
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!res.ok) {
      // If guest API fails, try generic HTML as last resort
      return scrapeGenericHTML(url);
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const parts = [];

    // Extract job title
    const title = $('.top-card-layout__title, .topcard__title, h1, h2').first().text().trim();
    if (title) parts.push(`Job Title: ${title}`);

    // Extract company name
    const company = $('.topcard__org-name-link, .top-card-layout__company-name, .topcard__flavor--black-link, a[data-tracking-control-name="public_jobs_topcard-org-name"]').first().text().trim();
    if (company) parts.push(`Company: ${company}`);

    // Extract location
    const location = $('.topcard__flavor--bullet, .top-card-layout__bullet, .topcard__flavor:not(.topcard__flavor--black-link)').first().text().trim();
    if (location && location.length < 200) parts.push(`Location: ${location}`);

    // Extract description
    const descSelectors = [
      '.description__text .show-more-less-html__markup',
      '.show-more-less-html__markup',
      '.description__text',
      '.description',
      'section.description',
    ];
    let desc = '';
    for (const sel of descSelectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 50) {
        desc = el.text().trim();
        break;
      }
    }

    // Extract criteria (seniority, employment type, etc.)
    $('.description__job-criteria-item').each((_, el) => {
      const label = $(el).find('.description__job-criteria-subheader').text().trim();
      const value = $(el).find('.description__job-criteria-text').text().trim();
      if (label && value) parts.push(`${label}: ${value}`);
    });

    if (desc) parts.push('\n' + desc);

    const result = parts.join('\n').trim();
    if (result.length < 50) {
      // Guest API returned thin content — try generic HTML
      return scrapeGenericHTML(url);
    }

    return cleanText(result);
  } catch (err) {
    // If guest API errors, fall back to generic
    return scrapeGenericHTML(url);
  }
}

// ── Indeed ─────────────────────────────────────────────────────
async function scrapeIndeed(url) {
  return scrapeGenericHTML(url);
}

// ── Naukri ─────────────────────────────────────────────────────
async function scrapeNaukri(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!res.ok) throw new Error('Naukri returned ' + res.status);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Naukri-specific selectors
  const selectors = ['.job-desc', '.jd-container', '.other-details', '[class*="jobDesc"]', '[class*="job-desc"]', '.styles_JDC__dang-inner-html__'];
  let text = '';
  for (const sel of selectors) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 50) { text = el.text().trim(); break; }
  }
  if (!text) text = extractFromJsonLd(html);
  if (!text || text.length < 50) throw new Error('Could not extract from Naukri.');
  return cleanText(text);
}

// ── SmartRecruiters ───────────────────────────────────────────
async function scrapeSmartRecruiters(url) {
  // SmartRecruiters has a public API: https://api.smartrecruiters.com/v1/companies/{id}/postings/{id}
  // But we need the company and posting IDs from the URL. Fall back to HTML.
  return scrapeGenericHTML(url);
}

// ── Generic HTML Scraper (with retry) ─────────────────────────
async function scrapeGenericHTML(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers = attempt === 0 ? HEADERS : getHeaders(); // Fresh UA on retry
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
      if (!res.ok) {
        if (res.status === 403 || res.status === 503) {
          throw new Error(`HTTP ${res.status} — site uses anti-bot protection`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const html = await res.text();

  // 1. Try JSON-LD structured data (most reliable)
  let text = extractFromJsonLd(html);
  if (text && text.length > 100) return cleanText(text);

  // 2. Cheerio DOM parsing
  const $ = cheerio.load(html);
  $('script,style,nav,header,footer,aside,iframe,noscript,svg,img,button,form,[role="navigation"],[role="banner"]').remove();

  const selectors = [
    '.description__text', '.show-more-less-html__markup',           // LinkedIn
    '#jobDescriptionText', '.jobsearch-jobDescriptionText',         // Indeed
    '.JobDesc_jobDescription__mRnIv', '#JobDescriptionContainer',   // Glassdoor
    '#content .content-intro', '#content',                          // Greenhouse
    '.posting-page .content', '.posting-categories + div',          // Lever
    '.job-sections', '.srt-job-details',                            // SmartRecruiters
    '.BambooHR-ATS-board__JobPost',                                 // BambooHR
    '.iCIMS_JobContent',                                            // iCIMS
    '[data-automation-id="jobPostingDescription"]',                  // Workday
    '[class*="job-description"]', '[class*="jobDescription"]',
    '[class*="job_description"]', '[class*="job-detail"]',
    '[class*="jobDetail"]', '[id*="job-description"]',
    '[id*="jobDescription"]', '[class*="posting-"]',
    'article', 'main', '.content', '#content',
  ];

  text = '';
  for (const sel of selectors) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 100) { text = el.text(); break; }
  }
  if (!text.trim()) text = $('body').text();
  const metadata = extractDomMetadata($);
  text = prependMetadataToText(cleanText(text), metadata);
  if (text.length < 50) throw new Error('Could not extract meaningful content.');
  return text;

    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        // Wait 2s before retry
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  throw lastError || new Error('Could not extract content after retry.');
}

// ── JSON-LD Extractor (enriched) ──────────────────────────────
function extractFromJsonLd(html) {
  const regex = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const postings = Array.isArray(data) ? data : [data];
      for (const item of postings) {
        if (item['@type'] === 'JobPosting' && item.description) {
          const parts = [];
          if (item.title) parts.push(`Job Title: ${item.title}`);
          // Extract company name from hiringOrganization
          if (item.hiringOrganization) {
            const orgName = typeof item.hiringOrganization === 'string' 
              ? item.hiringOrganization 
              : item.hiringOrganization.name;
            if (orgName) parts.push(`Company: ${orgName}`);
          }
          // Extract location
          if (item.jobLocation) {
            const loc = item.jobLocation;
            const addr = loc.address || loc;
            const locParts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
            if (locParts.length > 0) parts.push(`Location: ${locParts.join(', ')}`);
          }
          // Employment type
          if (item.employmentType) {
            const types = Array.isArray(item.employmentType) ? item.employmentType.join(', ') : item.employmentType;
            parts.push(`Employment Type: ${types}`);
          }
          // Description (HTML → text)
          const $ = cheerio.load(item.description);
          parts.push('\n' + $.text().trim());
          if (item.qualifications) parts.push(`\nQualifications: ${item.qualifications}`);
          return parts.join('\n');
        }
      }
    } catch (e) { /* skip invalid JSON */ }
  }
  return '';
}

function extractMetadataFromText(text = '') {
  const read = pattern => {
    const match = String(text || '').match(pattern);
    return match?.[1]?.trim() || '';
  };

  return {
    title: read(/^\s*Job Title:\s*([^\n]+)/im),
    company: read(/^\s*Company:\s*([^\n]+)/im),
    location: read(/^\s*Location:\s*([^\n]+)/im),
  };
}

function extractDomMetadata($) {
  const firstText = selectors =>
    selectors
      .map(selector => $(selector).first().text().trim())
      .find(Boolean) || '';

  const firstAttr = selectors =>
    selectors
      .map(selector => $(selector).attr('content') || '')
      .find(Boolean) || '';

  const title =
    firstText([
      'h1',
      '.jobsearch-JobInfoHeader-title',
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      '.top-card-layout__title',
      '.topcard__title',
      '[class*="job-title"]',
      '[class*="jobTitle"]',
      '.job-title',
    ]) ||
    firstAttr(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    $('title').text().trim().split('|')[0].trim();

  const company =
    firstText([
      '[data-company-name="true"]',
      '.jobsearch-CompanyInfoWithoutHeaderImage a',
      '.top-card-layout__company-name',
      '.topcard__org-name-link',
      '.companyName',
      '[data-testid="company-name"]',
      '[class*="company-name"]',
      '[class*="companyName"]',
    ]) || '';

  const location =
    firstText([
      '[data-testid="job-location"]',
      '.jobsearch-JobMetadataHeader-item',
      '.topcard__flavor--bullet',
      '.top-card-layout__bullet',
      '[class*="job-location"]',
      '[class*="jobLocation"]',
    ]) || '';

  return {
    title: cleanText(title).substring(0, 120),
    company: cleanText(company).substring(0, 120),
    location: cleanText(location).substring(0, 120),
  };
}

function prependMetadataToText(text, metadata = {}) {
  const parts = [];
  if (metadata.title && !/^\s*Job Title:/im.test(text)) parts.push(`Job Title: ${metadata.title}`);
  if (metadata.company && !/^\s*Company:/im.test(text)) parts.push(`Company: ${metadata.company}`);
  if (metadata.location && !/^\s*Location:/im.test(text)) {
    parts.push(`Location: ${metadata.location}`);
  }
  return parts.length ? `${parts.join('\n')}\n\n${text}` : text;
}

// ── Text Cleaner ──────────────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+$/gm, '')
    .trim();
}

module.exports = { getJobDescription };
