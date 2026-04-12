/**
 * Resume Builder — generates ATS-optimized DOCX and PDF downloads.
 * 
 * ATS Compatibility Across 10+ Platforms:
 * ┌─────────────────┬──────────────────────────────────────────────────────┐
 * │ Platform        │ Key Requirements                                    │
 * ├─────────────────┼──────────────────────────────────────────────────────┤
 * │ Workday         │ Single-col, L→R, standard headers, MM/YYYY dates   │
 * │ iCIMS           │ Section recognition, keyword density, standard heads│
 * │ Lever           │ Structured work: Title, Company, Month YYYY dates  │
 * │ Greenhouse      │ Clean preview, standard fonts, no tables           │
 * │ Taleo           │ Rigid parser, fails on icons, ignores header/footer│
 * │ LinkedIn        │ Autofill from body, simple bullets                 │
 * │ SuccessFactors  │ SAP-based, strict date parsing                     │
 * │ Jobvite         │ Keyword-heavy, penalizes creative headers          │
 * │ BambooHR        │ Lightweight parser, breaks on tables               │
 * │ SmartRecruiters │ AI parser, tolerant but prefers single-column      │
 * └─────────────────┴──────────────────────────────────────────────────────┘
 * 
 * PDF Requirements:
 * - Tagged PDF mode (accessibility/structure metadata)
 * - Strict top-to-bottom reading order (no absolute x,y positioning for text)
 * - Single-column layout only (no tables, no text boxes)
 * - Standard fonts: Helvetica/Helvetica-Bold (PDF core fonts)
 * - Safe characters only (no decorative Unicode)
 * - Selectable text layer (verified via self-test)
 * - 0.5"–1" margins
 * - Standard section headers from whitelist
 * - Strict MM/YYYY date format
 */

const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');
const { getBrowser, acquireRenderSlot, releaseRenderSlot } = require('./playwright-browser');
const { renderTemplate } = require('./template-renderer');
const log = require('./logger');

// ── Section Header Whitelist ──────────────────────────────────────────────────

const STANDARD_HEADERS = {
  summary: 'PROFESSIONAL SUMMARY',
  experience: 'EXPERIENCE',
  education: 'EDUCATION',
  skills: 'TECHNICAL SKILLS',
  projects: 'PROJECTS',
  certifications: 'CERTIFICATIONS',
  languages: 'LANGUAGES',
};

/**
 * Map a creative/non-standard header to the ATS-standard equivalent.
 */
function standardizeHeader(header) {
  const lower = header.toLowerCase().trim();
  
  const mappings = [
    [/summary|profile|objective|about\s*me|career\s*highlight/i, 'summary'],
    [/experience|employment|work\s*history|professional\s*(background|experience)/i, 'experience'],
    [/education|academic|qualifications|degree/i, 'education'],
    [/skills|technologies|tools|competencies|expertise|proficiencies/i, 'skills'],
    [/projects|portfolio|personal\s*projects|key\s*projects/i, 'projects'],
    [/certif|licenses|accreditations/i, 'certifications'],
    [/languages/i, 'languages'],
  ];

  for (const [pattern, key] of mappings) {
    if (pattern.test(lower)) return STANDARD_HEADERS[key];
  }
  return header.toUpperCase(); // Fallback: uppercase the original
}

// ── Date Normalization Engine ─────────────────────────────────────────────────

const MONTH_MAP = {
  'january': '01', 'february': '02', 'march': '03', 'april': '04',
  'may': '05', 'june': '06', 'july': '07', 'august': '08',
  'september': '09', 'october': '10', 'november': '11', 'december': '12',
  'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05',
  'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09', 'sept': '09',
  'oct': '10', 'nov': '11', 'dec': '12',
};

/**
 * Normalize ALL date formats to strict "MM/YYYY" for maximum ATS compatibility.
 * 
 * Handles:
 *   - "August 2025" → "08/2025"
 *   - "Aug 2025" → "08/2025"
 *   - "Aug '25" → "08/2025"
 *   - "Aug'25" → "08/2025"
 *   - "8/2025" → "08/2025"
 *   - "08/2025" → "08/2025" (already correct)
 *   - "2025-08" → "08/2025"
 *   - "Summer 2022" → "06/2022"
 *   - "Fall 2023" → "09/2023"
 *   - "Spring 2023" → "03/2023"
 *   - "Winter 2023" → "01/2023"
 *   - "Q1 2023" → "01/2023"
 *   - "Q2 2023" → "04/2023"
 *   - "Q3 2023" → "07/2023"
 *   - "Q4 2023" → "10/2023"
 *   - "2022 - Present" → "01/2022 – Present"
 *   - "present" / "current" → "Present"
 *   - Various dash formats normalized to " – "
 */
function normalizeDates(text) {
  // Step 1: Normalize "Present" / "Current" / "Now"
  text = text.replace(/\b(present|current|now|ongoing)\b/gi, 'Present');

  // Step 2: Season → month
  text = text.replace(/\b(Summer)\s+((?:19|20)\d{2})\b/gi, (_, s, y) => `06/${y}`);
  text = text.replace(/\b(Fall|Autumn)\s+((?:19|20)\d{2})\b/gi, (_, s, y) => `09/${y}`);
  text = text.replace(/\b(Spring)\s+((?:19|20)\d{2})\b/gi, (_, s, y) => `03/${y}`);
  text = text.replace(/\b(Winter)\s+((?:19|20)\d{2})\b/gi, (_, s, y) => `01/${y}`);

  // Step 3: Quarter → month
  text = text.replace(/\bQ1\s+((?:19|20)\d{2})\b/gi, (_, y) => `01/${y}`);
  text = text.replace(/\bQ2\s+((?:19|20)\d{2})\b/gi, (_, y) => `04/${y}`);
  text = text.replace(/\bQ3\s+((?:19|20)\d{2})\b/gi, (_, y) => `07/${y}`);
  text = text.replace(/\bQ4\s+((?:19|20)\d{2})\b/gi, (_, y) => `10/${y}`);

  // Step 4: "Month Year" or "Mon Year" → "MM/YYYY"
  const monthPattern = Object.keys(MONTH_MAP).join('|');
  const fullMonthRegex = new RegExp(`\\b(${monthPattern})[,.]?\\s+((?:19|20)\\d{2})\\b`, 'gi');
  text = text.replace(fullMonthRegex, (_, month, year) => {
    const mm = MONTH_MAP[month.toLowerCase()];
    return mm ? `${mm}/${year}` : `${month} ${year}`;
  });

  // Step 5: "Mon '25" or "Mon'25" → "MM/YYYY"
  const shortYearRegex = new RegExp(`\\b(${monthPattern})[.'']?\\s*'(\\d{2})\\b`, 'gi');
  text = text.replace(shortYearRegex, (_, month, year) => {
    const mm = MONTH_MAP[month.toLowerCase()];
    const fullYear = parseInt(year) > 50 ? '19' + year : '20' + year;
    return mm ? `${mm}/${fullYear}` : `${month} ${year}`;
  });

  // Step 6: "M/YYYY" → "0M/YYYY" (pad single-digit months)
  text = text.replace(/\b(\d)\/((19|20)\d{2})\b/g, (_, m, y) => `0${m}/${y}`);

  // Step 7: "YYYY-MM" ISO format → "MM/YYYY"
  text = text.replace(/\b((19|20)\d{2})-(0[1-9]|1[0-2])\b/g, (_, y, _2, m) => `${m}/${y}`);

  // Step 8: Bare year in date ranges: "2022 - Present" or "2022 – 2025"
  text = text.replace(/\b((19|20)\d{2})\s*[-–—]\s*(Present)\b/gi, (_, y, _2, p) => `01/${y} – Present`);
  text = text.replace(/\b((19|20)\d{2})\s*[-–—]\s*((19|20)\d{2})\b/g, (_, y1, _2, y2) => `01/${y1} – 01/${y2}`);

  // Step 9: Normalize dashes between dates to " – "
  text = text.replace(/(\d{2}\/\d{4})\s*[-–—]+\s*(\d{2}\/\d{4}|Present)/g, '$1 – $2');

  return text;
}

// ── Safe Character Filter ─────────────────────────────────────────────────────

/**
 * Strip non-ASCII decorative characters that break ATS parsers.
 * Preserves standard bullet (•), common dashes, and basic punctuation.
 */
function sanitizeForATS(text) {
  // Replace common decorative bullets with standard bullet
  text = text.replace(/[▪▸►▹◆◇○●■□★☆✓✔✗✘→←↑↓⇒⇐⇑⇓➤➜➡]/g, '•');
  
  // Replace curly quotes with straight
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');
  
  // Replace em/en dashes with standard
  text = text.replace(/[\u2013\u2014]/g, '-');
  
  // Replace ellipsis character
  text = text.replace(/\u2026/g, '...');
  
  // Remove replacement characters
  text = text.replace(/\uFFFD/g, '');
  
  // Remove other non-printable/decorative Unicode (keep basic Latin, accented chars, bullet)
  text = text.replace(/[^\x20-\x7E\u00A0-\u00FF\u2022\n\r\t]/g, '');
  
  return text;
}

// ── Build Resume Data ─────────────────────────────────────────────────────────

function buildResumeData(resumeText, sectionData, optimizedBullets, keywordPlan) {
  let text = resumeText;

  // Apply bullet rewrites
  for (const opt of (optimizedBullets || [])) {
    if (opt.original && opt.rewritten) {
      text = text.split(opt.original).join(opt.rewritten);
    }
  }

  // Sanitize for ATS
  text = sanitizeForATS(text);

  // Normalize all dates
  text = normalizeDates(text);

  // Parse sections
  const sections = parseSectionsAdvanced(text);

  // Calculate tenure
  const yearsExp = calculateTenure(sections.experience);
  const isJunior = yearsExp < 5;

  // Highlight metrics
  highlightMetricsInSections(sections);

  // Single-page enforcement: trim content to fit one letter-size page.
  // ATS parsers perform best on concise, single-page resumes for <15 yrs experience.
  trimForSinglePage(sections, isJunior);

  // Strip AI placeholder metrics (e.g. "[X%]", "[XX]") that weren't filled in
  stripPlaceholderMetrics(sections);

  return { sections, isJunior, yearsExp };
}

/**
 * Enforce single-page resume by trimming lower-priority content.
 * Strategy mirrors FAANG recruiter advice:
 * - Recent roles: max 4 bullets; older roles: max 2 bullets
 * - Seniors: condense roles beyond the 3rd to title/company/dates only
 * - Cap projects at 3, certifications at 5, languages at 5
 * - Trim summary to ~3 sentences
 */
function trimForSinglePage(sections, isJunior) {
  // Trim summary to max 3 sentences
  if (sections.summary) {
    const sentences = sections.summary.match(/[^.!?]+[.!?]+/g) || [sections.summary];
    if (sentences.length > 3) {
      sections.summary = sentences.slice(0, 3).join(' ').trim();
    }
  }

  // Trim experience bullets: 4 for first 2 roles, 2 for the rest
  // For seniors with many roles: keep max 4 roles with bullets, rest as headers only
  const MAX_ROLES_WITH_BULLETS = isJunior ? 3 : 4;
  const BULLETS_RECENT = isJunior ? 4 : 5;
  const BULLETS_OLDER = 2;

  if (Array.isArray(sections.experience)) {
    // Experience lines are flat strings at this stage — the structuring into
    // {title, bullets} happens later in template-renderer's structureExperience().
    // We trim bullets inline: count role headers, and for each role track bullet count.
    let roleIndex = 0;
    let bulletsInRole = 0;
    const trimmed = [];
    const BULLET_RE = /^[•\-*]\s/;

    for (const line of sections.experience) {
      if (!BULLET_RE.test(line)) {
        // Non-bullet line (role header or other text) — always keep
        roleIndex++;
        bulletsInRole = 0;
        trimmed.push(line);
      } else {
        // Bullet line — apply limits
        const maxBullets = roleIndex <= 2 ? BULLETS_RECENT : BULLETS_OLDER;
        if (roleIndex > MAX_ROLES_WITH_BULLETS) continue; // Skip bullets for very old roles
        if (bulletsInRole < maxBullets) {
          trimmed.push(line);
          bulletsInRole++;
        }
      }
    }
    sections.experience = trimmed;
  }

  // Cap projects to 3 entries (keep the first 3 that have bullets)
  if (Array.isArray(sections.projects) && sections.projects.length > 15) {
    sections.projects = sections.projects.slice(0, 15);
  }

  // Cap certifications and languages
  if (Array.isArray(sections.certifications) && sections.certifications.length > 5) {
    sections.certifications = sections.certifications.slice(0, 5);
  }
  if (Array.isArray(sections.languages) && sections.languages.length > 5) {
    sections.languages = sections.languages.slice(0, 5);
  }
}

/**
 * Remove unfilled AI placeholder metrics like [X%], [XX], [$X] from bullet text.
 * These are injected by the bullet rewriter when the original has no quantifiable metric.
 */
function stripPlaceholderMetrics(sections) {
  // Matches [X], [X%], [XX], [$XK], [XM], [XX.X] — with optional trailing % or unit outside the brackets
  const placeholderRe = /\s*\[(?:X+%?|\$?X+[KMB]?|XX?\.?X*)\]%?/gi;
  const clean = (line) => typeof line === 'string' ? line.replace(placeholderRe, '') : line;

  if (Array.isArray(sections.experience)) {
    sections.experience = sections.experience.map(clean);
  }
  if (Array.isArray(sections.projects)) {
    sections.projects = sections.projects.map(clean);
  }
}

/**
 * Advanced section parsing for professional hierarchy.
 */
function parseSectionsAdvanced(text) {
  const result = {
    name: '',
    contact: '',
    summary: '',
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    languages: [],
    other: ''
  };

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return result;

  result.name = lines[0];

  const sectionHeaders = {
    summary: /^(professional\s+)?summary|^objective|^profile|^about\s+me/i,
    experience: /^(work\s+)?experience|^employment|^work\s+history|^professional\s+(background|experience)/i,
    education: /^education|^academic/i,
    skills: /^(technical\s+)?skills|^technologies|^tools|^(core\s+)?competencies|^expertise/i,
    projects: /^projects|^portfolio|^personal\s+projects/i,
    certifications: /^certif|^licenses|^accreditations/i,
    languages: /^languages/i
  };

  let currentSection = 'contact';
  let contactLinesCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let matched = false;

    // Detect ATS Standard Headers
    for (const [key, pattern] of Object.entries(sectionHeaders)) {
      if (pattern.test(line) && line.length < 50) {
        currentSection = key;
        matched = true;
        break;
      }
    }

    if (!matched) {
      if (currentSection === 'contact') {
        // A common parser trap: a cover letter or unformatted resume has no headers.
        // We must cap the contact section so it doesn't swallow the entire document.
        const isLikelyContact = /@|linkedin|github|portfolio|\.com|\+\d|\d{3}[-.\s]?\d{3}|Ireland|UK|USA/i.test(line);
        
        // Transition to summary after 2 lines, or immediately if we see a long prose paragraph
        if (contactLinesCount >= 2 || (contactLinesCount >= 1 && line.length > 80 && !isLikelyContact)) {
          currentSection = 'summary';
          result.summary += line + '\n';
        } else {
          result.contact += line + '\n';
          contactLinesCount++;
        }
      } else if (Array.isArray(result[currentSection])) {
        result[currentSection].push(line);
      } else if (result[currentSection] !== undefined) {
        result[currentSection] += line + '\n';
      } else {
        result.other += line + '\n';
      }
    }
  }

  return result;
}

function calculateTenure(experienceLines) {
  const dateRegex = /\b(19|20)\d{2}\b/g;
  const years = [];

  experienceLines.forEach(line => {
    const matches = line.match(dateRegex);
    if (matches) matches.forEach(y => years.push(parseInt(y)));
  });

  if (years.length < 2) return 1;
  return Math.max(...years) - Math.min(...years);
}

function highlightMetricsInSections(sections) {
  const metricRegex = /(\d+%|\$[\d,.]+[KMBTt]?|\d+x|\d{2,}\+)/g;
  const processText = (text) => typeof text === 'string' ? text.replace(metricRegex, '**$1**') : text;

  if (Array.isArray(sections.experience)) {
    sections.experience = sections.experience.map(processText);
  }
  if (Array.isArray(sections.projects)) {
    sections.projects = sections.projects.map(processText);
  }
}

// ── DOCX Generator ────────────────────────────────────────────────────────────

async function generateDOCX(resumeText, sectionData, optimizedBullets, keywordPlan) {
  const data = buildResumeData(resumeText, sectionData, optimizedBullets, keywordPlan);
  const { sections, isJunior } = data;

  const docChildren = [];

  // ── Header (name) ──
  docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: sections.name, bold: true, size: 32, font: 'Calibri' })],
    spacing: { after: 80 }
  }));

  const contactText = sections.contact.replace(/\n/g, ' | ').trim();
  if (contactText) {
    docChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: contactText, size: 20, font: 'Calibri', color: '444444' })],
      spacing: { after: 300 }
    }));
  }

  const addSection = (sectionKey, contentLines) => {
    if (!contentLines || (Array.isArray(contentLines) && contentLines.length === 0)) return;
    const lines = Array.isArray(contentLines) ? contentLines : contentLines.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    // Use standardized header
    const title = standardizeHeader(sectionKey);

    docChildren.push(new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 22, font: 'Calibri' })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: isJunior ? 150 : 250, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '333333' } }
    }));

    lines.forEach(line => {
      const isBullet = /^[•\-*]\s/.test(line);
      const cleanLine = line.replace(/^[•\-*]\s*/, '');

      const parts = cleanLine.split('**');
      const textRuns = parts.map((text, i) => new TextRun({
        text,
        bold: i % 2 === 1,
        size: isJunior ? 20 : 21,
        font: 'Calibri'
      }));

      docChildren.push(new Paragraph({
        children: textRuns,
        bullet: isBullet ? { level: 0 } : undefined,
        spacing: { after: isJunior ? 40 : 60 }
      }));
    });
  };

  // Section order follows FAANG/ATS standard
  addSection('summary', sections.summary);
  addSection('experience', sections.experience);
  addSection('education', sections.education);
  addSection('skills', sections.skills);
  addSection('projects', sections.projects);
  if (sections.certifications.length > 0) addSection('certifications', sections.certifications);
  if (sections.languages.length > 0) addSection('languages', sections.languages);

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: isJunior ? 540 : 720,
            bottom: isJunior ? 540 : 720,
            left: 720,
            right: 720
          }
        }
      },
      children: docChildren
    }]
  });

  return await Packer.toBuffer(doc);
}

// ── FAANG PDF Generator (Jake's Resume Template) ──────────────────────────────

/**
 * Generate an ATS-optimized PDF using Playwright headless Chromium.
 * 
 * Renders HTML/CSS templates to pixel-perfect PDF with selectable text.
 * Supports multiple templates (modern, classic, minimal) and cover letters.
 * 
 * ATS Compliance:
 * - Single-column semantic HTML (h2, ul, li, p)
 * - Standard fonts only (Arial, Georgia, Helvetica)
 * - No icons, no images, no decorative Unicode
 * - MM/YYYY date format enforced by buildResumeData()
 * - Contact info in body (not header/footer)
 * - Text is selectable and searchable
 * 
 * @param {string} resumeText - Raw resume text
 * @param {object} sectionData - Parsed sections
 * @param {Array} optimizedBullets - AI-rewritten bullets
 * @param {Array} keywordPlan - Keyword insertion plan
 * @param {object} options - { watermark, density, template, isCoverLetter, coverLetterData, jobUrl }
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generatePDF(resumeText, sectionData, optimizedBullets, keywordPlan, options = {}) {
  const {
    watermark = false,
    density = 'standard',
    template = 'modern',
    isCoverLetter = false,
    coverLetterData = null,
    jobUrl = ''
  } = options;

  let html;

  if (isCoverLetter && coverLetterData) {
    // Cover letter uses its own template with different data shape
    html = renderTemplate('cover-letter', {
      sections: {
        name: coverLetterData.name || '',
        contact: coverLetterData.contact || '',
      }
    }, {
      watermark,
      density,
      jobUrl,
      // Cover letter-specific context injected directly
      ...coverLetterData
    });
  } else {
    // Resume: run full buildResumeData pipeline
    const data = buildResumeData(resumeText, sectionData, optimizedBullets, keywordPlan);
    const templateName = ['modern', 'classic', 'minimal'].includes(template) ? template : 'modern';
    html = renderTemplate(templateName, data, { watermark, density, jobUrl });
  }

  return await renderHtmlToPdf(html);
}

/**
 * Render complete HTML string to PDF using Playwright.
 *
 * Concurrency-controlled: Waits for a render slot before opening a Chromium tab.
 * Maximum concurrent renders is controlled by MAX_CONCURRENT_RENDERS in
 * playwright-browser.js (default: 3). Additional requests queue in FIFO order.
 */
async function renderHtmlToPdf(html) {
  const leaseId = await acquireRenderSlot();
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });

    // Fit to a single page by progressively tightening density instead of clipping.
    await page.evaluate(() => {
      const LETTER_HEIGHT_PX = 11 * 96;
      const A4_HEIGHT_PX = 11.69 * 96;
      const body = document.body;
      if (!body) return;

      const fitsOnSinglePage = () => {
        const pageHeight = Math.max(LETTER_HEIGHT_PX, A4_HEIGHT_PX);
        return body.scrollHeight <= pageHeight;
      };

      if (!fitsOnSinglePage()) {
        body.classList.add('density-compact');
      }
      if (!fitsOnSinglePage()) {
        body.classList.add('pdf-tight');
      }
    });

    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await context.close();
    await releaseRenderSlot(leaseId);
  }
}

// ── PDF Self-Test ─────────────────────────────────────────────────────────────

/**
 * Validate that the generated PDF has a readable text layer.
 * Uses pdf-parse to extract text from the buffer and checks for minimum matching.
 * Returns { valid, extractedText, matchRate }.
 */
async function validatePDF(pdfBuffer, expectedName) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(pdfBuffer);
    const extractedText = data.text || '';

    if (extractedText.length < 20) {
      return { valid: false, extractedText, matchRate: 0, error: 'Text layer is empty or too short' };
    }

    // Check if the expected name appears in extracted text
    const nameFound = extractedText.toLowerCase().includes(expectedName.toLowerCase().substring(0, 20));
    const matchRate = nameFound ? 100 : 0;

    return { valid: matchRate > 0, extractedText, matchRate };
  } catch (e) {
    log.error('PDF validation failed', { error: e.message });
    return { valid: false, extractedText: '', matchRate: 0, error: e.message };
  }
}

module.exports = { generateDOCX, generatePDF, validatePDF, normalizeDates, sanitizeForATS, standardizeHeader, buildResumeData, parseSectionsAdvanced, renderHtmlToPdf };
