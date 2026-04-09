/**
 * Context Humanizer — Anti-Fluff Engine
 * 
 * Post-processing module that strips AI-generated fluff from all LLM output.
 * Enforces grounded, human tone. Validates that business and technical context
 * are preserved (not abstracted into generic summaries).
 * 
 * Three stages:
 *   1. Ban List Scan   → Regex-replaces flagged words with human alternatives
 *   2. Tone Grounding  → Detects and downgrades flowery sentence structures
 *   3. Context Audit   → Flags bullets that lost specific technical/business context
 */

// ── STAGE 1: Ban List ─────────────────────────────────────────────────────────
// Words that are dead giveaways of AI-generated content. Each banned word
// maps to 0+ simple replacements. If no replacement exists, the word is 
// removed and the surrounding sentence is restructured.

const BAN_LIST = {
  // Tier 1 — Instant AI fingerprints (dead giveaways)
  'delve':            'examine',
  'delved':           'examined',
  'delving':          'examining',
  'tapestry':         null,       // Remove entirely — no business meaning
  'spearheaded':      'led',
  'spearhead':        'lead',
  'orchestrated':     'managed',
  'orchestrate':      'manage',
  'synergized':       'collaborated',
  'synergize':        'collaborate',
  'synergy':          'collaboration',
  'synergies':        'collaborations',
  'navigated':        'handled',
  'navigate':         'handle',
  'navigating':       'handling',
  'landscape':        'market',
  'landscapes':       'markets',
  'testament':        'example',
  'beacon':           'example',
  'fostered':         'built',
  'foster':           'build',
  'fostering':        'building',

  // Tier 2 — Common AI padding (usually adds zero information)
  'leveraged':        'used',
  'leverage':         'use',
  'leveraging':       'using',
  'utilized':         'used',
  'utilize':          'use',
  'utilizing':        'using',
  'utilization':      'use',
  'facilitated':      'led',
  'facilitate':       'lead',
  'facilitating':     'leading',
  'championed':       'led',
  'champion':         'lead',
  'championing':      'leading',
  'pioneered':        'started',
  'endeavor':         'project',
  'endeavors':        'projects',
  'endeavour':        'project',
  'myriad':           'many',
  'plethora':         'many',
  'multifaceted':     'complex',
  'holistic':         'full',
  'cutting-edge':     'modern',
  'cutting edge':     'modern',
  'state-of-the-art': 'modern',
  'best-in-class':    'top',
  'world-class':      'top',
  'groundbreaking':   'new',
  'game-changing':    'significant',
  'game-changer':     'improvement',
  'transformative':   'major',
  'transformational': 'major',
  'paradigm':         'approach',
  'paradigms':        'approaches',
  'paradigm shift':   'change',
  'ecosystem':        'system',
  'robust':           'strong',
  'seamless':         'smooth',
  'seamlessly':       'smoothly',
  'empower':          'enable',
  'empowered':        'enabled',
  'empowering':       'enabling',
  'stakeholders':     'teams',
  'cross-functional synergies': 'team collaboration',
  'end-to-end':       'full',
  'deep dive':        'analysis',
  'deep-dive':        'analysis',
  'double down':      'focus',
  'pivoted':          'shifted',
  'pivot':            'shift',

  // Tier 3 — Flowery resume verbs that sound inhuman
  'galvanized':       'motivated',
  'catalyzed':        'started',
  'catalyze':         'start',
  'revolutionized':   'improved',
  'revolutionize':    'improve',
  'envisioned':       'planned',
  'envision':         'plan',
  'architected':      'designed',
  'architect':        'design',
  'ideated':          'brainstormed',
  'ideate':           'brainstorm',
  'conceptualized':   'designed',
  'conceptualize':    'design',
  'operationalized':  'implemented',
  'operationalize':   'implement',
  'democratized':     'made accessible',
  'democratize':      'make accessible',
  'streamlined':      'simplified',
  'streamline':       'simplify',
};

// Phrases that signal AI-generated filler (regex patterns)
const FILLER_PATTERNS = [
  /\bin today's (?:fast-paced|rapidly evolving|ever-changing|dynamic)\b/gi,
  /\bin an increasingly\b/gi,
  /\bit is (?:worth noting|important to note|crucial to understand) that\b/gi,
  /\bthis (?:underscores|highlights|demonstrates|showcases) (?:the importance of|my ability to)\b/gi,
  /\bI am passionate about\b/gi,
  /\bI have a proven track record of\b/gi,
  /\bI thrive in\b/gi,
  /\ba dynamic (?:and )?(?:fast-paced )?environment\b/gi,
  /\bcommitted to (?:excellence|delivering|driving)\b/gi,
  /\bexceptional (?:ability|skill|talent)\b/gi,
  /\bstrong (?:communication|leadership|interpersonal) skills\b/gi,
  /\bseamlessly integrat(?:ed|ing)\b/gi,
  /\bfrom the ground up\b/gi,
  /\bat the forefront of\b/gi,
  /\bon the cutting edge\b/gi,
  /\bpushing the boundaries\b/gi,
  /\braised the bar\b/gi,
  /\bmoved the needle\b/gi,
];

// ── Build individual regexes per ban entry (avoids catastrophic backtracking) ──
const banKeys = Object.keys(BAN_LIST).sort((a, b) => b.length - a.length); // longest first
const BAN_ENTRIES = banKeys.map(key => ({
  key,
  replacement: BAN_LIST[key],
  regex: new RegExp('\\b' + key.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'),
}));

// ── STAGE 2: Tone Grounding ───────────────────────────────────────────────────

/**
 * Applies the ban list and filler pattern removal to a text string.
 * Preserves capitalization of replacements when the original was capitalized.
 */
function deFluff(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // Pass 1: Replace banned words (one at a time, longest first)
  for (const entry of BAN_ENTRIES) {
    result = result.replace(entry.regex, (match) => {
      if (entry.replacement === null) return ''; // Remove entirely
      // Preserve capitalization
      if (match[0] === match[0].toUpperCase()) {
        return entry.replacement.charAt(0).toUpperCase() + entry.replacement.slice(1);
      }
      return entry.replacement;
    });
  }

  // Pass 2: Remove filler phrases
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Pass 3: Clean up artifacts (double spaces, leading commas, etc.)
  result = result
    .replace(/\s{2,}/g, ' ')                // collapse multiple spaces
    .replace(/\s+([.,;:!?])/g, '$1')         // remove space before punctuation
    .replace(/([.,;:!?])\1+/g, '$1')         // collapse repeated punctuation
    .replace(/^\s*,\s*/gm, '')               // remove leading commas on lines
    .replace(/,\s*,/g, ',')                  // collapse double commas
    .replace(/\(\s*\)/g, '')                 // remove empty parens
    .trim();

  return result;
}

// ── STAGE 3: Context Retention Analysis ───────────────────────────────────────

/**
 * Analyzes a bullet point pair (original → rewritten) and checks whether
 * technical/business context was preserved. Returns an object with flags.
 * 
 * @param {string} original  — The user's original bullet text
 * @param {string} rewritten — The AI-generated rewrite
 * @returns {{ passed: boolean, warnings: string[], missingMetricPrompt: string|null }}
 */
function auditContextRetention(original, rewritten) {
  const result = {
    passed: true,
    warnings: [],
    missingMetricPrompt: null,
  };

  if (!original || !rewritten) return result;

  const origLower = original.toLowerCase();
  const rewritLower = rewritten.toLowerCase();

  // ── Check 1: Technical tool preservation ──────────────────────────────────
  // Extract specific technologies, tools, languages from the original
  const techPatterns = /\b(python|java|javascript|typescript|react|angular|vue|node\.?js|express|django|flask|spring|kubernetes|k8s|docker|aws|azure|gcp|terraform|jenkins|ci\/?cd|postgresql|postgres|mysql|mongodb|redis|kafka|rabbitmq|graphql|rest\s?api|grpc|sql|nosql|pandas|numpy|scipy|tensorflow|pytorch|spark|hadoop|airflow|tableau|power\s?bi|figma|jira|confluence|git|github|gitlab|linux|nginx|apache|elasticsearch|snowflake|databricks|dbt)\b/gi;

  const origTech = [...new Set((original.match(techPatterns) || []).map(t => t.toLowerCase()))];
  const rewritTech = [...new Set((rewritten.match(techPatterns) || []).map(t => t.toLowerCase()))];

  const droppedTech = origTech.filter(t => !rewritLower.includes(t));
  if (droppedTech.length > 0) {
    result.passed = false;
    result.warnings.push(`Technical context lost: "${droppedTech.join(', ')}" was in the original but removed from the rewrite.`);
  }

  // ── Check 2: Metric preservation ──────────────────────────────────────────
  // If the original had numbers/metrics, they must survive
  const origMetrics = original.match(/\$[\d,.]+[MBKmk]?|\d+%|\d+x\b|\d+\+?\s*(?:users?|customers?|clients?|engineers?|developers?|team members?|people|employees?|servers?|requests?|endpoints?|transactions?|records?|queries?|deploys?|releases?)|\d+[MBK]\+?\s*(?:revenue|ARR|MRR|users?)|\d+\s*(?:months?|weeks?|days?|hours?|minutes?|years?)/gi) || [];

  const rewritMetrics = rewritten.match(/\$[\d,.]+[MBKmk]?|\d+%|\d+x\b|\d+/gi) || [];

  if (origMetrics.length > 0 && rewritMetrics.length === 0) {
    result.passed = false;
    result.warnings.push(`Metrics stripped: The original had quantifiable data ("${origMetrics[0]}") but the rewrite removed it.`);
  }

  // ── Check 3: Missing metric detection (prompt user) ───────────────────────
  // If the rewrite has NO numbers at all, prompt the user for a metric
  const hasAnyMetric = /\d/.test(rewritten);
  const hasVagueResult = /\b(?:improved|increased|reduced|decreased|enhanced|boosted|grew|saved|accelerated|optimized|simplified|drove|delivered|managed|led|handled|built|cut|launched|completed|achieved|exceeded)\b/i.test(rewritten)
    && !hasAnyMetric;

  if (hasVagueResult) {
    result.missingMetricPrompt = 'This bullet claims an improvement but has no number. How much time, money, or effort did this save? (e.g., "reduced by 40%", "saved $12K/month", "cut from 3 days to 4 hours")';
  } else if (!hasAnyMetric && rewritten.length > 40) {
    result.missingMetricPrompt = 'Adding a metric would make this bullet 3x more compelling. Can you estimate the impact? (e.g., team size, revenue affected, time saved)';
  }

  // ── Check 4: Company/project name preservation ────────────────────────────
  // Look for capitalized proper nouns in the original that may be company/project names
  const properNouns = original.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) || [];
  const significantNouns = properNouns.filter(n => {
    const lower = n.toLowerCase();
    // Exclude common non-contextual words that happen to be capitalized
    return !['the', 'this', 'that', 'with', 'from', 'into', 'team', 'company',
             'project', 'system', 'platform', 'tool', 'data', 'service',
             'built', 'managed', 'led', 'designed', 'created'].includes(lower)
           && n.length > 3;
  });

  for (const noun of significantNouns) {
    if (!rewritten.includes(noun) && !rewritLower.includes(noun.toLowerCase())) {
      // Only flag if it looks like a proper noun / product name (not a generic word)
      if (/^[A-Z]/.test(noun) && origLower.indexOf(noun.toLowerCase()) < origLower.length / 2) {
        result.warnings.push(`Context may be lost: "${noun}" was mentioned in original but not in rewrite. If this is a product/company name, it should be preserved.`);
      }
    }
  }

  return result;
}

// ── Convenience: Full pipeline ────────────────────────────────────────────────

/**
 * Run the full humanizer pipeline on a bullet rewrite result.
 * Mutates the result object in-place.
 * 
 * @param {{ original: string, rewritten: string, targetKeyword?: string, method?: string }} result
 * @returns {result} — Same object, with rewritten text de-fluffed and context audit attached
 */
function humanizeBulletResult(result) {
  if (!result || !result.rewritten) return result;

  // Stage 1 + 2: De-fluff the rewritten text
  result.rewritten = deFluff(result.rewritten);

  // Stage 3: Context retention audit
  result.contextAudit = auditContextRetention(result.original, result.rewritten);

  return result;
}

/**
 * De-fluff freeform text (cover letters, linkedin suggestions, etc.)
 * No context audit — just ban list + filler removal.
 */
function humanizeText(text) {
  return deFluff(text);
}

/**
 * Returns the ban list for UI display / documentation.
 */
function getBanList() {
  return Object.keys(BAN_LIST);
}

/**
 * Checks if a given text string contains any banned terms.
 * Returns array of { word, replacement, index } objects.
 */
function scanForFluff(text) {
  if (!text) return [];
  const hits = [];
  for (const entry of BAN_ENTRIES) {
    const regex = new RegExp(entry.regex.source, 'gi'); // fresh instance
    let match;
    while ((match = regex.exec(text)) !== null) {
      hits.push({
        word: match[0],
        replacement: entry.replacement,
        index: match.index,
      });
    }
  }
  return hits;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  deFluff,
  auditContextRetention,
  humanizeBulletResult,
  humanizeText,
  getBanList,
  scanForFluff,
  BAN_LIST,
  FILLER_PATTERNS,
};
