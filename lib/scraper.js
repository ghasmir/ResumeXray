const fetch = require('node-fetch');
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
      return { text: await scrapeWorkday(url), platform: 'Workday', scraped: true };
    }
    // ── Greenhouse ──
    if (host.includes('greenhouse.io') || host.includes('boards.greenhouse.io')) {
      return { text: await scrapeGreenhouse(url), platform: 'Greenhouse', scraped: true };
    }
    // ── Lever ──
    if (host.includes('lever.co') || host.includes('jobs.lever.co')) {
      return { text: await scrapeLever(url), platform: 'Lever', scraped: true };
    }
    // ── LinkedIn ──
    if (host.includes('linkedin.com')) {
      return { text: await scrapeLinkedIn(url), platform: 'LinkedIn', scraped: true };
    }
    // ── Indeed ──
    if (host.includes('indeed.com')) {
      return { text: await scrapeIndeed(url), platform: 'Indeed', scraped: true };
    }
    // ── Glassdoor ──
    if (host.includes('glassdoor.com') || host.includes('glassdoor.co')) {
      return { text: await scrapeGenericHTML(url), platform: 'Glassdoor', scraped: true };
    }
    // ── Naukri ──
    if (host.includes('naukri.com')) {
      return { text: await scrapeNaukri(url), platform: 'Naukri', scraped: true };
    }
    // ── iCIMS ──
    if (host.includes('icims.com')) {
      return { text: await scrapeGenericHTML(url), platform: 'iCIMS', scraped: true };
    }
    // ── SmartRecruiters ──
    if (host.includes('smartrecruiters.com')) {
      return { text: await scrapeSmartRecruiters(url), platform: 'SmartRecruiters', scraped: true };
    }
    // ── Generic fallback ──
    return { text: await scrapeGenericHTML(url), platform: 'generic', scraped: true };

  } catch (err) {
    // Don't throw — return the error info so the caller can handle it gracefully
    throw new Error(`Could not extract from ${host}. ${err.message || 'Please paste the job description text instead.'}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM-SPECIFIC SCRAPERS
// ═══════════════════════════════════════════════════════════════

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

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
  const apiRes = await fetch(apiUrl, { headers: { ...HEADERS, Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: 15000 });

  if (apiRes.ok) {
    const data = await apiRes.json();
    return parseWorkdayResponse(data, jobReqId);
  }

  // Fallback: full path
  const fullPath = pathParts.slice(startIdx + 1).join('/');
  const altRes = await fetch(`https://${hostname}/wday/cxs/${tenant}/${site}/${fullPath}`, { headers: { ...HEADERS, Accept: 'application/json' }, timeout: 15000 });
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
  const res = await fetch(apiUrl, { headers: HEADERS, timeout: 15000 });
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
  const res = await fetch(apiUrl, { headers: HEADERS, timeout: 15000 });
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
  // LinkedIn blocks scrapers heavily. Try the public HTML with JSON-LD.
  return scrapeGenericHTML(url);
}

// ── Indeed ─────────────────────────────────────────────────────
async function scrapeIndeed(url) {
  return scrapeGenericHTML(url);
}

// ── Naukri ─────────────────────────────────────────────────────
async function scrapeNaukri(url) {
  const res = await fetch(url, { headers: HEADERS, timeout: 15000, redirect: 'follow' });
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

// ── Generic HTML Scraper ──────────────────────────────────────
async function scrapeGenericHTML(url) {
  const res = await fetch(url, { headers: HEADERS, timeout: 20000, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  text = cleanText(text);
  if (text.length < 50) throw new Error('Could not extract meaningful content.');
  return text;
}

// ── JSON-LD Extractor ─────────────────────────────────────────
function extractFromJsonLd(html) {
  const regex = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const postings = Array.isArray(data) ? data : [data];
      for (const item of postings) {
        if (item['@type'] === 'JobPosting' && item.description) {
          const $ = cheerio.load(item.description);
          let desc = $.text().trim();
          if (item.title) desc = `Job Title: ${item.title}\n\n${desc}`;
          if (item.qualifications) desc += `\n\nQualifications: ${item.qualifications}`;
          return desc;
        }
      }
    } catch (e) { /* skip invalid JSON */ }
  }
  return '';
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
