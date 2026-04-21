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
const { renderTemplate, structureExperience, structureEducation, structureProjects } = require('./template-renderer');
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
  text = text.replace(/(?<!\/)\b((19|20)\d{2})\s*[-–—]\s*(Present)\b/gi, (_, y) => `01/${y} – Present`);
  text = text.replace(/(?<!\/)\b((19|20)\d{2})\s*[-–—]\s*((19|20)\d{2})\b/g, (_, y1, _2, y2) => `01/${y1} – 01/${y2}`);

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

function splitNonEmptyLines(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function isLikelyContactLine(line) {
  if (!line) return false;
  return /@|linkedin|github|portfolio|https?:\/\/|www\.|\+\d|\(?\d{3}[\d\s().-]{4,}|ireland|united kingdom|usa|remote/i.test(
    line
  );
}

function looksLikeContactBlock(text) {
  const lines = splitNonEmptyLines(text);
  return lines.length > 0 && lines.every(isLikelyContactLine);
}

function extractHeadlineFromHeaderBlock(text) {
  const lines = splitNonEmptyLines(text).filter(line => {
    if (isLikelyContactLine(line)) return false;
    if (/^(summary|experience|education|skills|projects|certif|languages)$/i.test(line)) {
      return false;
    }
    return line.length <= 120;
  });
  return lines.join(' ').trim();
}

function looksLikeExperienceHeaderLine(line) {
  if (!line) return false;
  const clean = line.trim();
  if (!clean) return false;
  if (/^\d{2}\/\d{4}\s*[–-]\s*(?:\d{2}\/\d{4}|Present)$/i.test(clean)) return true;
  if (/^\(?[A-Z][^@]{0,80}\)\s*[-–—]\s*[A-Z]/.test(clean)) return true;
  if (/^[, ]+[A-Z].+[-–—]\s*[A-Z]/.test(clean)) return true;
  if (clean.length <= 90 && /(?:\sat\s)|[-–—|]/i.test(clean)) return true;
  if (
    clean.length <= 60 &&
    /^[A-Z][A-Za-z0-9&'().,/ ]+$/.test(clean) &&
    clean.split(/\s+/).length <= 6 &&
    !/^(development|designed|implemented|managed|collaborated|using|including|reducing|improving)$/i.test(
      clean
    )
  ) {
    return true;
  }
  return false;
}

// ── Build Resume Data ─────────────────────────────────────────────────────────
// Pipeline order (post-refactor):
//   1. Sanitize + normalize the ORIGINAL text (no bullet rewrites on flat text)
//   2. parseSectionsAdvanced() on clean text → flat section arrays
//   3. Trim + metric highlighting on flat arrays
//   4. Structure flat arrays into objects via structureExperience/Education/Projects
//   5. Apply bullet rewrites surgically on structured objects

function buildResumeData(resumeText, sectionData, optimizedBullets, keywordPlan) {
  // Step 1: Sanitize and normalize the ORIGINAL text — NO bullet string-replace here.
  let text = sanitizeForATS(resumeText);
  text = normalizeDates(text);

  // Step 2: Parse sections from clean, original text
  const sections = parseSectionsAdvanced(text);

  // Recover a clean name/contact/header summary from the persisted parser state when available.
  const persistedName = typeof sectionData?.name === 'string' ? sectionData.name.trim() : '';
  const persistedContact =
    typeof sectionData?.contact === 'string' ? splitNonEmptyLines(sectionData.contact).join(' | ') : '';
  const recoveredHeadline = extractHeadlineFromHeaderBlock(sections.contact);

  if (persistedName) sections.name = persistedName;
  if (persistedContact) sections.contact = persistedContact;
  if (recoveredHeadline && (!sections.summary || looksLikeContactBlock(sections.summary))) {
    sections.summary = recoveredHeadline;
  } else if (looksLikeContactBlock(sections.summary)) {
    sections.summary = '';
  }

  // Step 3: Calculate tenure, highlight metrics, trim — all on flat arrays (still fine)
  const yearsExp = calculateTenure(sections.experience);
  const isJunior = yearsExp < 5;
  const maxPages = yearsExp > 3 ? 2 : 1;
  highlightMetricsInSections(sections);
  trimForSinglePage(sections, { isJunior, maxPages });
  stripPlaceholderMetrics(sections);

  // Step 4: Structure flat arrays into template-ready objects (on clean, un-replaced text)
  sections.experience = structureExperience(sections.experience);
  sections.education = structureEducation(sections.education);
  sections.projects = structureProjects(sections.projects);

  // Step 5: Apply bullet rewrites on structured objects — surgical and safe
  applyBulletRewrites(sections, optimizedBullets);
  applyKeywordPlan(sections, keywordPlan);
  polishProfessionalSummary(sections, { yearsExp, keywordPlan });

  return { sections, isJunior, yearsExp, maxPages };
}

function polishProfessionalSummary(sections, { yearsExp = 0, keywordPlan = [] } = {}) {
  const currentRole = Array.isArray(sections.experience) ? sections.experience[0] : null;
  const currentTitle = String(currentRole?.title || '').trim();
  const currentCompany = String(currentRole?.company || '').trim();
  const rawSummary = String(sections.summary || '').replace(/\s+/g, ' ').trim();

  const normalizedSkills = [];
  if (Array.isArray(sections.skills)) {
    for (const item of sections.skills) {
      if (typeof item === 'string') {
        normalizedSkills.push(
          ...item
            .replace(/^skills?\s*:\s*/i, '')
            .split(/[,|;/]/)
            .map(part => part.trim())
            .filter(Boolean)
        );
      } else if (item?.items) {
        normalizedSkills.push(
          ...String(item.items)
            .split(/[,|;/]/)
            .map(part => part.trim())
            .filter(Boolean)
        );
      }
    }
  }

  const keywordHints = Array.isArray(keywordPlan)
    ? keywordPlan
        .filter(item => item && item.honest !== false)
        .map(item => String(item.keyword || '').trim())
        .filter(Boolean)
    : [];

  const skills = [...new Set([...normalizedSkills, ...keywordHints])]
    .filter(skill => skill.length >= 2 && skill.length <= 28)
    .slice(0, 4);

  const bulletText = Array.isArray(currentRole?.bullets) ? currentRole.bullets.join(' ') : '';
  const hasMetrics = /\b\d+(?:[.,]\d+)?(?:%|x|\+|k|m|b)?\b/i.test(bulletText);
  const focusAreas = [];
  if (/\b(customer|client|support|service|account)\b/i.test(bulletText)) focusAreas.push('customer-facing execution');
  if (/\b(sales|revenue|pipeline|conversion|quota)\b/i.test(bulletText)) focusAreas.push('commercial impact');
  if (/\b(process|workflow|operations|delivery|implementation)\b/i.test(bulletText)) focusAreas.push('process improvement');
  if (/\b(data|analytics|reporting|dashboard)\b/i.test(bulletText)) focusAreas.push('data-informed decision making');

  const uniqueFocus = [...new Set(focusAreas)].slice(0, 2);
  const yearsLabel =
    yearsExp >= 1 ? `${Math.max(1, Math.round(yearsExp))}+ years of experience` : 'Early-career experience';
  const roleLabel = currentTitle
    ? `${yearsLabel} as a ${currentTitle}`
    : `${yearsLabel} delivering professional results`;
  const companyLabel = currentCompany ? ` at ${currentCompany}` : '';
  const skillsLabel = skills.length > 0 ? ` with strength in ${skills.slice(0, 3).join(', ')}` : '';
  const impactLabel =
    uniqueFocus.length > 0
      ? `Known for ${uniqueFocus.join(' and ')}`
      : hasMetrics
        ? 'Known for delivering measurable results'
        : 'Known for clear execution, strong communication, and dependable follow-through';

  const fallbackSummary = `${roleLabel}${companyLabel}${skillsLabel}. ${impactLabel}.`;

  if (!rawSummary) {
    sections.summary = fallbackSummary;
    return;
  }

  let polished = rawSummary
    .replace(/\b(i am|i'm|i have|i've|my|me)\b/gi, '')
    .replace(/\b(hardworking|passionate|motivated|results-driven|dynamic|go-getter|team player|detail-oriented)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!/[.!?]$/.test(polished)) polished += '.';
  const sentenceParts = polished
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  polished = sentenceParts.join(' ');

  if (polished.split(/\s+/).length < 14 || /professional\b.*professional/i.test(polished)) {
    sections.summary = fallbackSummary;
    return;
  }

  if (skills.length > 0 && !skills.some(skill => polished.toLowerCase().includes(skill.toLowerCase()))) {
    polished = `${polished.replace(/[.!?]+$/, '')} Core strengths include ${skills.slice(0, 3).join(', ')}.`;
  }

  sections.summary = polished;
}

/**
 * Apply optimized bullet rewrites on structured experience/project entries.
 * Operates on {title, company, bullets[]} objects — never on flat text.
 * Uses substring matching because sanitizeForATS and normalizeDates may have
 * slightly modified the original text relative to the bullet originals.
 */
function applyBulletRewrites(sections, optimizedBullets) {
  if (!optimizedBullets || optimizedBullets.length === 0) return;

  const rewriteMap = new Map();
  for (const opt of optimizedBullets) {
    if (opt.original && opt.rewritten) {
      rewriteMap.set(
        opt.original.trim().replace(/\s+/g, ' '),
        opt.rewritten.trim()
      );
    }
  }
  if (rewriteMap.size === 0) return;

  function rewriteBullets(entries) {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry.bullets || !Array.isArray(entry.bullets)) continue;
      entry.bullets = entry.bullets.map(bullet => {
        const normalized = bullet.trim().replace(/\s+/g, ' ');
        for (const [original, rewritten] of rewriteMap) {
          if (normalized.includes(original) || original.includes(normalized)) {
            return rewritten;
          }
        }
        return bullet;
      });
    }
  }

  rewriteBullets(sections.experience);
  rewriteBullets(sections.projects);
}

/**
 * Enforce single-page resume by trimming lower-priority content.
 * Strategy mirrors FAANG recruiter advice:
 * - Recent roles: max 4 bullets; older roles: max 2 bullets
 * - Seniors: condense roles beyond the 3rd to title/company/dates only
 * - Cap projects at 3, certifications at 5, languages at 5
 * - Trim summary to ~3 sentences
 */
function trimForSinglePage(sections, { isJunior, maxPages = 1 } = {}) {
  // Tighten early-career resumes to one page; allow seasoned profiles more room.
  const summarySentences = maxPages > 1 ? 3 : 2;
  if (sections.summary) {
    const sentences = sections.summary.match(/[^.!?]+[.!?]+/g) || [sections.summary];
    if (sentences.length > summarySentences) {
      sections.summary = sentences.slice(0, summarySentences).join(' ').trim();
    }
  }

  const MAX_ROLES_WITH_BULLETS = maxPages > 1 ? (isJunior ? 4 : 5) : 3;
  const BULLETS_RECENT = maxPages > 1 ? 4 : 3;
  const BULLETS_SECOND = maxPages > 1 ? 3 : 2;
  const BULLETS_OLDER = maxPages > 1 ? 2 : 1;

  if (Array.isArray(sections.experience)) {
    // Experience lines are flat strings at this stage — the structuring into
    // {title, bullets} happens later in template-renderer's structureExperience().
    // We trim bullets inline: count role headers, and for each role track bullet count.
    let roleIndex = 0;
    let bulletsInRole = 0;
    const trimmed = [];
    const BULLET_RE = /^[•\-*]\s/;

    for (const line of sections.experience) {
      const isBullet = BULLET_RE.test(line);
      const isHeader = looksLikeExperienceHeaderLine(line);

      if (isHeader) {
        roleIndex++;
        bulletsInRole = 0;
        trimmed.push(line);
      } else if (isBullet) {
        if (roleIndex === 0) roleIndex = 1;
        // Bullet line — apply limits
        const maxBullets =
          roleIndex === 1 ? BULLETS_RECENT : roleIndex === 2 ? BULLETS_SECOND : BULLETS_OLDER;
        if (roleIndex > MAX_ROLES_WITH_BULLETS) continue; // Skip bullets for very old roles
        if (bulletsInRole < maxBullets) {
          trimmed.push(line);
          bulletsInRole++;
        }
      } else {
        // Wrapped bullet lines and additional context should stay with the current role.
        // Counting every non-bullet line as a new role was truncating good content.
        trimmed.push(line);
      }
    }
    sections.experience = trimmed;
  }

  const maxProjectLines = maxPages > 1 ? 15 : 10;
  if (Array.isArray(sections.projects) && sections.projects.length > maxProjectLines) {
    sections.projects = sections.projects.slice(0, maxProjectLines);
  }

  // Cap certifications and languages
  const maxMetaItems = maxPages > 1 ? 5 : 3;
  if (Array.isArray(sections.certifications) && sections.certifications.length > maxMetaItems) {
    sections.certifications = sections.certifications.slice(0, maxMetaItems);
  }
  if (Array.isArray(sections.languages) && sections.languages.length > maxMetaItems) {
    sections.languages = sections.languages.slice(0, maxMetaItems);
  }
}

function extractKeywordSuggestionText(suggestion = '', fallbackKeyword = '') {
  const text = String(suggestion || '').trim();
  if (!text) return String(fallbackKeyword || '').trim();

  const quoted = text.match(/['"]([^'"]+)['"]/);
  if (quoted && quoted[1]) return quoted[1].trim();

  const asMatch = text.match(/(?:add|include)[^:]*:\s*(.+)$/i);
  if (asMatch && asMatch[1]) return asMatch[1].trim().replace(/\.$/, '');

  return String(fallbackKeyword || '').trim();
}

function splitSuggestionItems(text = '') {
  return String(text || '')
    .split(/[,;/]|(?:\s+\|\s+)/)
    .map(item => item.trim())
    .filter(Boolean);
}

function applyKeywordPlan(sections, keywordPlan) {
  if (!Array.isArray(keywordPlan) || keywordPlan.length === 0) return;

  const skillTerms = [];
  let summaryClauses = [];

  for (const item of keywordPlan) {
    if (!item || item.honest === false) continue;
    const section = String(item.section || '').trim().toLowerCase();
    const suggestionText = extractKeywordSuggestionText(item.suggestion, item.keyword);
    if (!suggestionText) continue;

    if (section === 'skills') {
      skillTerms.push(...splitSuggestionItems(suggestionText));
    } else if (section === 'summary') {
      summaryClauses.push(suggestionText);
    }
  }

  if (skillTerms.length > 0) {
    const existingSkillText = Array.isArray(sections.skills) ? sections.skills.join(' | ') : '';
    const existingLower = existingSkillText.toLowerCase();
    const additions = skillTerms.filter(term => {
      const clean = term.replace(/^skills?\s*:\s*/i, '').trim();
      return clean && !existingLower.includes(clean.toLowerCase());
    });

    if (additions.length > 0) {
      const primaryLine =
        Array.isArray(sections.skills) && sections.skills.length > 0
          ? String(sections.skills[0]).trim()
          : 'Additional Skills:';
      const cleanPrimary = primaryLine.replace(/\s+$/, '');
      const prefix = /:/.test(cleanPrimary) ? cleanPrimary : `${cleanPrimary}${cleanPrimary ? ', ' : ''}`;

      if (Array.isArray(sections.skills) && sections.skills.length > 0) {
        sections.skills[0] = `${prefix}${prefix.endsWith(':') ? ' ' : ''}${additions.join(', ')}`.trim();
      } else {
        sections.skills = [`Additional Skills: ${additions.join(', ')}`];
      }
    }
  }

  if (summaryClauses.length > 0 && sections.summary) {
    const uniqueClauses = summaryClauses.filter(clause => {
      return !sections.summary.toLowerCase().includes(clause.toLowerCase());
    });
    if (uniqueClauses.length > 0) {
      sections.summary = `${sections.summary.replace(/\s+$/, '')} ${uniqueClauses[0]}`.trim();
    }
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

    // Use standardized header
    const title = standardizeHeader(sectionKey);

    docChildren.push(new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 22, font: 'Calibri' })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: isJunior ? 150 : 250, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '333333' } }
    }));

    // Handle structured experience/education/project entries (objects with bullets)
    if (Array.isArray(contentLines) && contentLines[0] && typeof contentLines[0] === 'object' && contentLines[0].bullets) {
      for (const entry of contentLines) {
        const headerParts = [entry.title, entry.company, entry.location, entry.dates].filter(Boolean);
        if (headerParts.length > 0) {
          docChildren.push(new Paragraph({
            children: [new TextRun({ text: headerParts.join(' — '), bold: true, size: isJunior ? 20 : 21, font: 'Calibri' })],
            spacing: { before: 120, after: 60 }
          }));
        }
        for (const bullet of (entry.bullets || [])) {
          const parts = bullet.split('**');
          const textRuns = parts.map((text, i) => new TextRun({
            text,
            bold: i % 2 === 1,
            size: isJunior ? 20 : 21,
            font: 'Calibri'
          }));
          docChildren.push(new Paragraph({
            children: textRuns,
            bullet: { level: 0 },
            spacing: { after: isJunior ? 40 : 60 }
          }));
        }
      }
      return;
    }

    // Handle structured education entries (objects with degree/school/details)
    if (Array.isArray(contentLines) && contentLines[0] && typeof contentLines[0] === 'object' && contentLines[0].degree !== undefined) {
      for (const entry of contentLines) {
        const headerParts = [entry.degree, entry.school, entry.dates].filter(Boolean);
        if (headerParts.length > 0) {
          docChildren.push(new Paragraph({
            children: [new TextRun({ text: headerParts.join(' — '), bold: true, size: isJunior ? 20 : 21, font: 'Calibri' })],
            spacing: { before: 120, after: 60 }
          }));
        }
        for (const detail of (entry.details || [])) {
          docChildren.push(new Paragraph({
            children: [new TextRun({ text: detail, size: isJunior ? 20 : 21, font: 'Calibri' })],
            spacing: { after: isJunior ? 40 : 60 }
          }));
        }
      }
      return;
    }

    // Fallback: flat lines (skills, certifications, languages, or legacy data)
    const lines = Array.isArray(contentLines) ? contentLines : contentLines.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    lines.forEach(line => {
      // Handle structured skill objects { category, items }
      if (typeof line === 'object' && line.items) {
        const text = line.category ? `${line.category}: ${line.items}` : line.items;
        docChildren.push(new Paragraph({
          children: [new TextRun({ text, size: isJunior ? 20 : 21, font: 'Calibri' })],
          spacing: { after: isJunior ? 40 : 60 }
        }));
        return;
      }

      const lineStr = typeof line === 'string' ? line : String(line);
      const isBullet = /^[•\-*]\s/.test(lineStr);
      const cleanLine = lineStr.replace(/^[•\-*]\s*/, '');

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
    jobUrl = '',
    maxPages = 1,
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

  return await renderHtmlToPdf(html, { maxPages });
}

/**
 * Render complete HTML string to PDF using Playwright.
 *
 * Concurrency-controlled: Waits for a render slot before opening a Chromium tab.
 * Maximum concurrent renders is controlled by MAX_CONCURRENT_RENDERS in
 * playwright-browser.js (default: 3). Additional requests queue in FIFO order.
 */
async function renderHtmlToPdf(html, options = {}) {
  const maxPages = Number.isInteger(options.maxPages) && options.maxPages > 1 ? 2 : 1;
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

    // Fit to the allowed page budget by progressively tightening density.
    await page.evaluate(allowedPages => {
      const LETTER_CONTENT_HEIGHT_PX = (11 - 1.0) * 96 * allowedPages; // 0.5in top + bottom margins
      const body = document.body;
      if (!body) return;

      const cleanupEmptyLists = () => {
        document.querySelectorAll('ul').forEach(list => {
          if (!list.querySelector('li')) list.remove();
        });
      };

      const fitsOnSinglePage = () => body.scrollHeight <= LETTER_CONTENT_HEIGHT_PX;

      const clampSummary = maxSentences => {
        const summary = document.querySelector('.section-summary .summary-text');
        if (!summary) return;
        const raw = summary.textContent?.trim() || '';
        if (!raw) return;
        const parts = raw.match(/[^.!?]+[.!?]+/g) || [raw];
        if (parts.length > maxSentences) {
          summary.textContent = parts.slice(0, maxSentences).join(' ').trim();
        }
      };

      const trimEntryBullets = (selector, limitResolver) => {
        document.querySelectorAll(selector).forEach((entry, index) => {
          const items = Array.from(entry.querySelectorAll('li'));
          const limit = Math.max(0, limitResolver(index));
          items.slice(limit).forEach(item => item.remove());
        });
        cleanupEmptyLists();
      };

      const trimEducationDetails = maxItems => {
        document.querySelectorAll('.section-education .entry').forEach(entry => {
          const items = Array.from(entry.querySelectorAll('li'));
          items.slice(maxItems).forEach(item => item.remove());
        });
        cleanupEmptyLists();
      };

      const removeSection = selector => {
        const section = document.querySelector(selector);
        if (section) section.remove();
      };

      if (!fitsOnSinglePage()) {
        body.classList.add('density-compact');
      }
      if (!fitsOnSinglePage()) {
        body.classList.add('pdf-tight');
      }
      if (!fitsOnSinglePage()) {
        body.classList.add('pdf-ultra-tight');
      }
      if (allowedPages === 1 && !fitsOnSinglePage()) {
        clampSummary(2);
      }
      if (allowedPages === 1 && !fitsOnSinglePage()) {
        trimEntryBullets(
          '.section-experience .entry',
          index => (index === 0 ? 3 : index === 1 ? 2 : 1)
        );
      }
      if (allowedPages === 1 && !fitsOnSinglePage()) {
        trimEducationDetails(1);
      }
      if (allowedPages === 1 && !fitsOnSinglePage()) {
        removeSection('.section-projects');
      }
      if (allowedPages === 1 && !fitsOnSinglePage()) {
        removeSection('.section-certifications');
        removeSection('.section-languages');
      }
      if (allowedPages === 1 && !fitsOnSinglePage()) {
        document.querySelectorAll('.section-experience .entry').forEach((entry, index) => {
          if (index >= 4) entry.remove();
        });
      }
      if (allowedPages === 1 && !fitsOnSinglePage()) {
        removeSection('.section-summary');
      }
    }, maxPages);

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
 * Uses pdf-parse to extract text from the buffer and checks for:
 * - non-empty selectable text
 * - bounded page count
 * - optional name match when available
 * Returns { valid, extractedText, matchRate, pageCount, textLength }.
 */
async function validatePDF(pdfBuffer, expectedNameOrOptions) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(pdfBuffer);
    const extractedText = data.text || '';

    const options =
      expectedNameOrOptions && typeof expectedNameOrOptions === 'object'
        ? expectedNameOrOptions
        : { expectedName: expectedNameOrOptions };

    const expectedName = (options.expectedName || '').trim();
    const maxPages = Number.isInteger(options.maxPages) ? options.maxPages : 2;
    const minTextLength = Number.isInteger(options.minTextLength) ? options.minTextLength : 20;
    const textLength = extractedText.replace(/\s+/g, ' ').trim().length;
    const pageCount = data.numpages || (pdfBuffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;

    if (textLength < minTextLength) {
      return {
        valid: false,
        extractedText,
        matchRate: 0,
        pageCount,
        textLength,
        error: 'Text layer is empty or too short',
      };
    }

    if (pageCount > maxPages) {
      return {
        valid: false,
        extractedText,
        matchRate: 0,
        pageCount,
        textLength,
        error: `PDF exceeds ${maxPages} pages`,
      };
    }

    // Check if the expected name appears in extracted text
    let matchRate = 100;
    if (expectedName) {
      const nameFound = extractedText
        .toLowerCase()
        .includes(expectedName.toLowerCase().substring(0, 20));
      matchRate = nameFound ? 100 : 0;
    }

    return { valid: matchRate > 0, extractedText, matchRate, pageCount, textLength };
  } catch (e) {
    log.error('PDF validation failed', { error: e.message });
    return {
      valid: false,
      extractedText: '',
      matchRate: 0,
      pageCount: 0,
      textLength: 0,
      error: e.message,
    };
  }
}

module.exports = { generateDOCX, generatePDF, validatePDF, normalizeDates, sanitizeForATS, standardizeHeader, buildResumeData, parseSectionsAdvanced, renderHtmlToPdf };
