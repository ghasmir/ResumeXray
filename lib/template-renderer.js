/**
 * Template Renderer — Handlebars HTML Compilation for Resume PDFs
 * 
 * Compiles and caches Handlebars templates on first use.
 * Returns complete HTML strings ready for Playwright to render to PDF.
 * 
 * ATS Compatibility Matrix (all templates):
 * ┌─────────────────┬───────────────────────────────────────────────────┐
 * │ Platform        │ Compliance                                        │
 * ├─────────────────┼───────────────────────────────────────────────────┤
 * │ Workday         │ Single-col, L→R, standard headers, MM/YYYY dates │
 * │ Lever           │ Structured entries, Title + Company + Date         │
 * │ Greenhouse      │ Clean preview, no tables, standard fonts          │
 * │ Taleo           │ No icons, no header/footer, rigid parsing         │
 * │ Indeed          │ Text-based PDF, keyword-rich, selectable text     │
 * │ LinkedIn        │ Clean sections, simple bullets, autofill-friendly │
 * │ Glassdoor       │ Standard format, searchable text layer            │
 * │ iCIMS           │ Section recognition, keyword density              │
 * │ SmartRecruiters │ AI parser, single-column preferred                │
 * │ BambooHR        │ Lightweight parser, breaks on tables              │
 * └─────────────────┴───────────────────────────────────────────────────┘
 */

const Handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

// ── Cache ──────────────────────────────────────────────────────────────────────
// Production: templates and CSS are compiled once and cached for the process lifetime.
// Development: templates reload from disk on every render (hot-reload without restart).

const IS_PROD = process.env.NODE_ENV === 'production';
let baseCss = null;
const compiledTemplates = {};

function loadBaseCss() {
  if (!IS_PROD || !baseCss) {
    baseCss = fs.readFileSync(path.join(TEMPLATES_DIR, 'base.css'), 'utf-8');
  }
  return baseCss;
}

function getTemplate(name) {
  if (!IS_PROD || !compiledTemplates[name]) {
    const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Template not found: ${name}`);
    }
    const source = fs.readFileSync(filePath, 'utf-8');
    compiledTemplates[name] = Handlebars.compile(source);
  }
  return compiledTemplates[name];
}

// ── Handlebars Helpers ─────────────────────────────────────────────────────────

Handlebars.registerHelper('formatContact', function(contactParts) {
  if (!contactParts || !Array.isArray(contactParts)) return '';
  return contactParts.filter(Boolean).join('  |  ');
});

Handlebars.registerHelper('boldMetrics', function(text) {
  if (!text) return '';
  // Convert generated markdown: **value**
  let formatted = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Bold numbers with units: "45%", "$2.3M", "150+", "3x"
  formatted = formatted.replace(/(\$?\d[\d,.]*[%+xX]?(?:\s*(?:million|billion|users|customers|clients|requests|orders|employees|team\s+members))?)/g, '<strong>$1</strong>');
  return new Handlebars.SafeString(formatted);
});

Handlebars.registerHelper('ifEquals', function(a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('each_limit', function(arr, limit, options) {
  if (!arr) return '';
  let result = '';
  const max = Math.min(arr.length, limit || arr.length);
  for (let i = 0; i < max; i++) {
    result += options.fn(arr[i]);
  }
  return result;
});

// ── Platform Detection (from job URL) ──────────────────────────────────────────

const PLATFORM_PATTERNS = {
  workday:        /myworkday(anyday)?\.com|workday\.com/i,
  lever:          /lever\.co|jobs\.lever\.co/i,
  greenhouse:     /greenhouse\.io|boards\.greenhouse\.io/i,
  indeed:         /indeed\.com/i,
  linkedin:       /linkedin\.com/i,
  glassdoor:      /glassdoor\.com/i,
  icims:          /icims\.com/i,
  taleo:          /taleo\.(net|com)|oracle.*recruit/i,
  smartrecruiters:/smartrecruiters\.com/i,
  bamboohr:       /bamboohr\.com/i,
  ashby:          /ashbyhq\.com/i,
  jobvite:        /jobvite\.com/i,
};

/**
 * Detect which ATS platform a job URL belongs to.
 * @param {string} jobUrl 
 * @returns {{ platform: string|null, hint: string }}
 */
function detectPlatform(jobUrl) {
  if (!jobUrl) return { platform: null, hint: '' };
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(jobUrl)) {
      return { platform, hint: getPlatformHint(platform) };
    }
  }
  return { platform: null, hint: '' };
}

function getPlatformHint(platform) {
  const hints = {
    workday:        'Workday requires MM/YYYY dates and fails on tables/text boxes.',
    lever:          'Lever expects structured Title, Company, Date entries.',
    greenhouse:     'Greenhouse needs clean preview with no tables.',
    taleo:          'Taleo is strict — no icons, no header/footer content.',
    indeed:         'Indeed prefers keyword-rich, text-based PDFs.',
    linkedin:       'LinkedIn auto-fills from body text — keep it simple.',
    glassdoor:      'Glassdoor uses standard searchable text format.',
    icims:          'iCIMS requires strong section recognition and keyword density.',
    smartrecruiters:'SmartRecruiters AI parser prefers single-column.',
    bamboohr:       'BambooHR has a lightweight parser — avoid tables.',
    ashby:          'Ashby supports modern formats but prefers clean structure.',
    jobvite:        'Jobvite is keyword-heavy, penalizes creative headers.',
  };
  return hints[platform] || '';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Render a resume or cover letter to complete HTML.
 * 
 * @param {string} templateName - 'modern' | 'classic' | 'minimal' | 'cover-letter'
 * @param {object} data - Output from buildResumeData()
 * @param {object} options - { watermark, density, jobUrl }
 * @returns {string} Complete HTML document
 */
function renderTemplate(templateName, data, options = {}) {
  const { watermark = false, density = 'standard', jobUrl = '' } = options;
  const template = getTemplate(templateName);
  const css = loadBaseCss();

  // Detect platform from job URL for potential hints
  const platformInfo = detectPlatform(jobUrl);

  if (templateName === 'cover-letter') {
    const context = {
      name: data.name || '',
      contact: Array.isArray(data.contact) ? data.contact : buildContactArray(data.contact || ''),
      date: data.date || '',
      recipientName: data.recipientName || '',
      recipientTitle: data.recipientTitle || '',
      companyName: data.companyName || '',
      paragraphs: data.paragraphs || [],
      watermark,
      compact: density === 'compact',
      baseCss: css,
    };
    return template(context);
  }

  // Transform flat string arrays into structured objects for Handlebars templates
  const rawExp = data.sections?.experience || [];
  const rawEdu = data.sections?.education || [];
  const rawSkills = data.sections?.skills || [];
  const rawProjects = data.sections?.projects || [];

  const context = {
    // Resume data — structured for templates
    name: data.sections?.name || '',
    contact: buildContactArray(data.sections?.contact || ''),
    summary: data.sections?.summary || '',
    experience: structureExperience(rawExp),
    education: structureEducation(rawEdu),
    skills: structureSkills(rawSkills),
    projects: structureProjects(rawProjects),
    certifications: data.sections?.certifications || [],
    languages: data.sections?.languages || [],
    isJunior: data.isJunior || false,

    // Rendering options
    watermark,
    compact: density === 'compact',
    baseCss: css,

    // Platform detection
    platform: platformInfo.platform,
    platformHint: platformInfo.hint,
  };

  return template(context);
}

module.exports = { renderTemplate, detectPlatform, PLATFORM_PATTERNS };

// ── Internal Helpers ───────────────────────────────────────────────────────────

function buildContactArray(contactString) {
  if (!contactString) return [];
  if (Array.isArray(contactString)) return contactString;
  
  // Split contact line by common separators
  return contactString
    .split(/\s*[|·•]\s*|\s{3,}/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Data Structuring: Flat Lines → Template Objects ────────────────────────────

/**
 * Detect if a line is a date range (e.g. "01/2023 – Present", "2020 - 2023")
 */
const DATE_RANGE_RE = /\b\d{2}\/\d{4}\b.*[-–—]|[-–—].*\b\d{2}\/\d{4}\b|\b(19|20)\d{2}\b.*[-–—].*\b(Present|(19|20)\d{2})\b/i;
const DATE_ONLY_RE = /\b\d{2}\/\d{4}\b|\b(19|20)\d{2}\b/;
const BULLET_RE = /^[•\-\*]\s/;

function isDateOnlyLine(line) {
  return /^\s*(?:\d{2}\/\d{4}|(19|20)\d{2})\s*[-–—]\s*(?:\d{2}\/\d{4}|(19|20)\d{2}|Present)\s*\.?\s*$/i.test(
    String(line || '').trim()
  );
}

function normalizeDateLine(line) {
  return String(line || '')
    .trim()
    .replace(/\s*[-–—]\s*/g, ' – ')
    .replace(/\.$/, '');
}

function isLikelyRoleTitle(text) {
  const clean = String(text || '').trim();
  if (!clean || clean.length > 80) return false;
  return /(engineer|developer|manager|analyst|scientist|architect|designer|consultant|specialist|administrator|intern|lead|director|officer|associate)/i.test(
    clean
  );
}

function splitCompanyAndLocation(text) {
  const parts = String(text || '')
    .replace(/^,\s*/, '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return { company: parts[0] || String(text || '').trim(), location: '' };
  }
  return { company: parts[0], location: parts.slice(1).join(', ') };
}

/**
 * Check if a line looks like a role/title header (not a bullet, contains a date
 * or is short enough to be a title, and isn't a skill/cert).
 */
function isLikelyEntryHeader(line) {
  // Has a date range embedded
  if (DATE_RANGE_RE.test(line)) return true;
  // Short, non-bullet line that looks like "Title - Company" or "Title, Company"
  if (!BULLET_RE.test(line) && line.length < 100 && /[-–—,|]/.test(line)) return true;
  return false;
}

/**
 * Parse title, company, location, dates from a header line.
 * Handles common patterns:
 *   "Software Engineer - Google, Mountain View  01/2022 – Present"
 *   "Software Engineer | Google | 01/2022 – Present"
 *   "Software Engineer at Google  01/2022 – Present"
 */
function parseEntryHeader(line) {
  let dates = '';
  let rest = line;

  // Extract date range from the line
  const dateMatch = rest.match(/(\d{2}\/\d{4}\s*[-–—]\s*(?:\d{2}\/\d{4}|Present))/i);
  if (dateMatch) {
    dates = dateMatch[1].replace(/\s*[-–—]\s*/g, ' – ');
    rest = rest.replace(dateMatch[0], '').trim();
  } else {
    // Try bare year range: "2020 - 2023" or "2020 - Present"
    const yearMatch = rest.match(/((19|20)\d{2})\s*[-–—]\s*((19|20)\d{2}|Present)/i);
    if (yearMatch) {
      dates = yearMatch[0].replace(/\s*[-–—]\s*/g, ' – ');
      rest = rest.replace(yearMatch[0], '').trim();
    }
  }

  // Clean trailing separators  
  rest = rest.replace(/[,|·\-–—\s]+$/, '').trim();

  // Try to split title from company
  let title = rest;
  let company = '';
  let location = '';

  // Pattern: "Title - Company" or "Title | Company" or "Title, Company"
  const splitMatch = rest.match(/^(.+?)\s*[-–—|]\s*(.+)$/);
  if (splitMatch) {
    const left = splitMatch[1].trim().replace(/^,\s*/, '');
    const right = splitMatch[2].trim();

    if ((left.includes(',') || left.toLowerCase().includes('remote')) && isLikelyRoleTitle(right)) {
      title = right;
      const companyAndLocation = splitCompanyAndLocation(left);
      company = companyAndLocation.company;
      location = companyAndLocation.location;
    } else {
      title = left;
      // Check if there's a location after the company: "Company, City"
      const locMatch = right.match(/^(.+?),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)$/);
      if (locMatch) {
        company = locMatch[1].trim();
        location = locMatch[2].trim();
      } else {
        company = right;
      }
    }
  } else {
    // Pattern: "Title at Company"
    const atMatch = rest.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atMatch) {
      title = atMatch[1].trim();
      company = atMatch[2].trim();
    }
  }

  return { title, company, location, dates };
}

/**
 * Structure flat experience lines into template-ready objects.
 */
function structureExperience(lines) {
  if (!lines || lines.length === 0) return [];
  // If already structured (from a different code path), return as-is
  if (lines[0] && typeof lines[0] === 'object') return lines;

  const entries = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    if (!BULLET_RE.test(line) && nextLine && /^,\s*/.test(nextLine) && !DATE_ONLY_RE.test(line)) {
      if (current) entries.push(current);
      const locationRole = nextLine.replace(/^,\s*/, '').trim();
      const split = locationRole.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      const dates = isDateOnlyLine(lines[i + 2]) ? normalizeDateLine(lines[i + 2]) : '';
      current = {
        title: split ? split[2].trim() : locationRole,
        company: line.trim(),
        location: split ? split[1].trim() : '',
        dates,
        bullets: [],
      };
      i += dates ? 2 : 1;
      continue;
    }

    if (!BULLET_RE.test(line) && isDateOnlyLine(line) && current && !current.dates) {
      current.dates = normalizeDateLine(line);
      continue;
    }

    if (BULLET_RE.test(line)) {
      // It's a bullet — add to current entry
      const clean = line.replace(BULLET_RE, '').trim();
      if (current) {
        current.bullets.push(clean);
      } else {
        // Orphan bullet before any header — create a generic entry
        current = { title: '', company: '', location: '', dates: '', bullets: [clean] };
      }
    } else if (isLikelyEntryHeader(line)) {
      // New entry header
      if (current) entries.push(current);
      const parsed = parseEntryHeader(line);
      current = { ...parsed, bullets: [] };
    } else {
      // Non-bullet, non-header — could be additional info 
      // If short, treat as sub-header (company line after title)
      if (current && current.bullets.length === 0 && !current.company && line.length < 80) {
        // Possibly a company/location line that appeared on its own
        current.company = line;
      } else if (current) {
        if (current.bullets.length > 0) {
          // If this is not a bullet but we already have bullets, it's likely a wrapped line
          current.bullets[current.bullets.length - 1] += ' ' + line.trim();
        } else {
          current.bullets.push(line);
        }
      } else {
        // First line that isn't a clear header — treat as title
        current = { title: line, company: '', location: '', dates: '', bullets: [] };
      }
    }
  }
  if (current) entries.push(current);

  return entries;
}

/**
 * Structure flat education lines into template-ready objects.
 */
function structureEducation(lines) {
  if (!lines || lines.length === 0) return [];
  if (lines[0] && typeof lines[0] === 'object') return lines;

  const entries = [];
  let current = null;

  for (const line of lines) {
    if (BULLET_RE.test(line)) {
      const clean = line.replace(BULLET_RE, '').trim();
      if (current) current.details.push(clean);
    } else if (DATE_ONLY_RE.test(line) || (!BULLET_RE.test(line) && line.length < 120)) {
      // Likely a degree/school header line
      if (current && (current.degree || current.details.length > 0)) {
        entries.push(current);
      }
      
      const parsed = parseEntryHeader(line);
      current = {
        degree: parsed.title,
        school: parsed.company,
        dates: parsed.dates,
        details: []
      };
    } else {
      if (current) {
        current.details.push(line);
      } else {
        current = { degree: line, school: '', dates: '', details: [] };
      }
    }
  }
  if (current) entries.push(current);

  return entries;
}

/**
 * Structure flat skills lines into template-ready objects.
 * Handles patterns like:
 *   "Languages: Python, Java, C++"
 *   "Frameworks: React, Node.js, Django"
 *   "Python, Java, C++, React, Node.js"
 */
function structureSkills(lines) {
  if (!lines || lines.length === 0) return [];
  if (lines[0] && typeof lines[0] === 'object') return lines;

  const entries = [];

  for (const line of lines) {
    const clean = line.replace(BULLET_RE, '').trim();
    // Check for "Category: items" pattern
    const colonMatch = clean.match(/^([^:]{2,30}):\s*(.+)$/);
    if (colonMatch) {
      entries.push({
        category: colonMatch[1].trim(),
        items: colonMatch[2].trim()
      });
    } else {
      // Plain list — no category
      entries.push({
        category: '',
        items: clean
      });
    }
  }

  return entries;
}

/**
 * Structure flat project lines into template-ready objects.
 */
function structureProjects(lines) {
  if (!lines || lines.length === 0) return [];
  if (lines[0] && typeof lines[0] === 'object') return lines;

  const entries = [];
  let current = null;

  for (const line of lines) {
    if (BULLET_RE.test(line)) {
      const clean = line.replace(BULLET_RE, '').trim();
      if (current) {
        current.bullets.push(clean);
      } else {
        current = { name: '', dates: '', bullets: [clean] };
      }
    } else {
      if (current) entries.push(current);
      const parsed = parseEntryHeader(line);
      current = { name: parsed.title || line, dates: parsed.dates || '', bullets: [] };
    }
  }
  if (current) entries.push(current);

  return entries;
}
