/**
 * Keyword extraction and matching engine.
 *
 * Uses ATS-safe term dictionaries with boundary-aware matching so
 * unrelated words like "escalated", "rapid", or "excellent" never
 * trigger skills such as Scala, API, or Excel.
 */

// ── Skill Dictionaries ──────────────────────────────────────────────────────

const HARD_SKILLS = new Set([
  // Programming
  'javascript','typescript','python','java','c++','c#','ruby','golang','rust',
  'swift','kotlin','php','scala','matlab','perl','sql','nosql','graphql',
  // Web
  'html','css','sass','less','react','angular','vue','svelte','next.js','nuxt',
  'node.js','express','django','flask','fastapi','spring','rails','laravel',
  'asp.net','rest','api','restful','webpack','vite','babel',
  // Data / ML
  'machine learning','deep learning','nlp','natural language processing',
  'computer vision','tensorflow','pytorch','keras','scikit-learn','pandas',
  'numpy','spark','hadoop','data science','data engineering','etl',
  'data visualization','tableau','power bi','looker',
  // Cloud / DevOps
  'aws','azure','gcp','google cloud','docker','kubernetes','k8s','terraform',
  'ansible','jenkins','ci/cd','github actions','gitlab ci','circleci',
  'linux','unix','bash','shell scripting','nginx','apache',
  // Databases
  'postgresql','mysql','mongodb','redis','elasticsearch','dynamodb',
  'cassandra','oracle','sql server','sqlite','firebase','supabase',
  // Mobile
  'ios','android','react native','flutter','xamarin','swiftui',
  // Design
  'figma','sketch','adobe xd','photoshop','illustrator','ui/ux','ux design',
  'ui design','wireframing','prototyping','user research',
  // Other Tech
  'git','github','gitlab','bitbucket','jira','confluence','agile','scrum',
  'kanban','microservices','soa','event-driven','rabbitmq','kafka',
  'grpc','websockets','oauth','jwt','saml','sso','encryption','security',
  'penetration testing','seo','a/b testing','analytics','google analytics',
  'segment','mixpanel','amplitude',
  // Business / Data
  'excel','powerpoint','word','google sheets','salesforce','hubspot',
  'sap','erp','crm','business intelligence','financial modeling',
  'accounting','bookkeeping','quickbooks',
]);

const SOFT_SKILLS = new Set([
  'leadership','communication','teamwork','collaboration','problem solving',
  'critical thinking','analytical','creativity','innovation','adaptability',
  'flexibility','time management','project management','organization',
  'attention to detail','decision making','conflict resolution','negotiation',
  'presentation','public speaking','mentoring','coaching','empathy',
  'emotional intelligence','self-motivated','proactive','strategic thinking',
  'cross-functional','stakeholder management','customer service','interpersonal',
  'multitasking','prioritization','delegation','accountability','resilience',
  'work ethic','initiative','resourcefulness',
]);

const CERTIFICATIONS = new Set([
  'pmp','cpa','cfa','aws certified','azure certified','gcp certified',
  'scrum master','csm','psm','cissp','ceh','comptia','a+','network+',
  'security+','ccna','ccnp','itil','six sigma','lean','green belt',
  'black belt','google analytics certified','hubspot certified',
  'salesforce certified','togaf','prince2','safe','pmi-acp',
  'certified kubernetes','ckad','cka','terraform associate',
]);

const LOW_SIGNAL_SOFT_SKILLS = new Set([
  'communication',
  'teamwork',
  'collaboration',
  'problem solving',
  'critical thinking',
  'adaptability',
  'flexibility',
  'time management',
  'organization',
  'project management',
  'attention to detail',
  'multitasking',
  'interpersonal',
]);

const TERM_ALIASES = Object.freeze({
  api: ['api', 'apis'],
  organization: ['organization', 'organisation', 'organizational', 'organisational'],
  excel: ['excel', 'microsoft excel'],
  'node.js': ['node.js', 'node js'],
  'next.js': ['next.js', 'next js'],
  'asp.net': ['asp.net', 'asp net'],
  'ci/cd': ['ci/cd', 'ci cd', 'continuous integration', 'continuous deployment'],
  'ui/ux': ['ui/ux', 'ui ux'],
  'google cloud': ['google cloud', 'gcp'],
  'power bi': ['power bi', 'powerbi'],
  'a/b testing': ['a/b testing', 'ab testing'],
  'machine learning': ['machine learning', 'ml'],
  'natural language processing': ['natural language processing', 'nlp'],
  'customer service': ['customer service', 'customer support'],
});

// Acronym ↔ expansion map for fuzzy matching
const ACRONYMS = {
  seo: 'search engine optimization',
  sem: 'search engine marketing',
  crm: 'customer relationship management',
  erp: 'enterprise resource planning',
  'ci/cd': 'continuous integration continuous deployment',
  ml: 'machine learning',
  dl: 'deep learning',
  nlp: 'natural language processing',
  cv: 'computer vision',
  ai: 'artificial intelligence',
  ui: 'user interface',
  ux: 'user experience',
  qa: 'quality assurance',
  pm: 'project management',
  ba: 'business analysis',
  bi: 'business intelligence',
  roi: 'return on investment',
  kpi: 'key performance indicator',
  okr: 'objectives and key results',
  saas: 'software as a service',
  paas: 'platform as a service',
  iaas: 'infrastructure as a service',
  sdk: 'software development kit',
  ide: 'integrated development environment',
  orm: 'object relational mapping',
  mvc: 'model view controller',
  mvp: 'minimum viable product',
  poc: 'proof of concept',
  r2r: 'record to report',
  p2p: 'procure to pay',
  b2b: 'business to business',
  b2c: 'business to consumer',
};

// Common stop words to exclude from keyword extraction
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall','can',
  'this','that','these','those','it','its','i','we','you','they','he','she',
  'me','us','him','her','them','my','our','your','their','his','who','whom',
  'which','what','when','where','how','why','if','then','else','so','than',
  'too','very','just','about','above','below','between','through','during',
  'before','after','up','down','out','off','over','under','again','further',
  'once','here','there','all','each','every','both','few','more','most',
  'other','some','such','no','not','only','own','same','also','into',
  'able','must','need','etc','per','via','vs','ie','eg','including',
  'include','experience','work','working','strong','well','good','great',
  'excellent','required','preferred','plus','years','year','team','role',
  'position','company','job','looking','ideal','candidate','apply',
  'responsibility','responsibilities','requirement','requirements',
  'qualification','qualifications','benefit','benefits','salary','location',
  'full-time','part-time','remote','hybrid','onsite',
]);

const REQUIREMENT_HEADING_PATTERNS = [
  { pattern: /^(responsibilities|what you will do|what you'll do)$/i, tier: 'responsibilities' },
  { pattern: /^(essential requirements|requirements|required|qualifications|must have|must-haves)$/i, tier: 'essential' },
  { pattern: /^(the successful candidate will have|you will have)$/i, tier: 'essential' },
  { pattern: /^(desirable requirements|preferred|nice to have|nice-to-have)$/i, tier: 'desirable' },
];

const REQUIREMENT_WEIGHTS = Object.freeze({
  context: 0.3,
  responsibilities: 0.85,
  essential: 1,
  desirable: 0.45,
});

/**
 * Extract keywords from text using boundary-aware dictionary matching.
 * Returns an object with categorised keywords.
 */
function extractKeywords(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const words = tokenize(lower);
  const freq = {};

  for (const word of words) {
    if (!STOP_WORDS.has(word) && word.length > 1) {
      freq[word] = (freq[word] || 0) + 1;
    }
  }

  const sections = parseRequirementSections(raw);
  const hardSkills = detectDictionaryKeywords(raw, HARD_SKILLS, 'hard_skill', sections);
  const softSkills = detectDictionaryKeywords(raw, SOFT_SKILLS, 'soft_skill', sections);
  const certifications = detectDictionaryKeywords(raw, CERTIFICATIONS, 'certification', sections);

  if (/\b(?:golang|go(?:\s+language|\s+developer|\s+engineer|\s+microservices?|\s+backend))\b/i.test(raw)) {
    upsertEntry(hardSkills, {
      term: 'golang',
      count: Math.max(1, countTermMatches(raw, 'golang')),
      category: 'hard_skill',
      importance: 1,
      explicitRequirement: false,
      tiers: [],
    });
  }

  if (/\b(?:r(?:\s+programming|\s+language|\s+studio|\s+developer)?|rstudio|tidyverse)\b/i.test(raw)) {
    upsertEntry(hardSkills, {
      term: 'r',
      count: 1,
      category: 'hard_skill',
      importance: 1,
      explicitRequirement: false,
      tiers: [],
    });
  }

  for (const entry of [...hardSkills, ...softSkills, ...certifications]) {
    freq[entry.term] = Math.max(freq[entry.term] || 0, entry.count);
  }

  const otherKeywords = Object.entries(freq)
    .filter(([term, count]) => {
      return (
        count >= 2 &&
        term.length > 2 &&
        !HARD_SKILLS.has(term) &&
        !SOFT_SKILLS.has(term) &&
        !CERTIFICATIONS.has(term)
      );
    })
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  return {
    hardSkills: sortEntries(hardSkills),
    softSkills: sortEntries(softSkills),
    certifications: sortEntries(certifications),
    otherKeywords,
    allTerms: freq,
  };
}

/**
 * Match resume keywords against JD keywords.
 * Returns matched, missing, and stats.
 */
function matchKeywords(resumeKeywords, jdKeywords) {
  const resumeAll = new Set(Object.keys(resumeKeywords.allTerms));
  const resumeExpanded = expandTerms(resumeAll);

  const jdImportant = [
    ...jdKeywords.hardSkills,
    ...jdKeywords.softSkills.filter(isHighSignalSoftSkill),
    ...jdKeywords.certifications,
  ].sort((a, b) => {
    const priorityDelta = (b.importance || 0) - (a.importance || 0);
    return priorityDelta !== 0 ? priorityDelta : (b.count || 0) - (a.count || 0);
  });

  const matched = [];
  const missing = [];

  for (const keyword of jdImportant) {
    const term = keyword.term;
    const isPresent = resumeExpanded.has(term) || fuzzyMatch(term, resumeExpanded);
    const result = { ...keyword, category: keyword.category || categorize(term) };
    if (isPresent) matched.push(result);
    else missing.push(result);
  }

  const totalJD = matched.length + missing.length;
  const matchRate = totalJD > 0 ? Math.round((matched.length / totalJD) * 100) : 0;

  return {
    matched,
    missing,
    matchRate,
    totalJDKeywords: totalJD,
    totalResumeKeywords: resumeAll.size,
    resumeHardSkills: resumeKeywords.hardSkills,
    resumeSoftSkills: resumeKeywords.softSkills,
    resumeCertifications: resumeKeywords.certifications,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function tokenize(text) {
  return String(text || '')
    .replace(/[^a-z0-9#+.\-/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function sortEntries(entries = []) {
  return entries.sort((a, b) => {
    const importanceDelta = (b.importance || 0) - (a.importance || 0);
    return importanceDelta !== 0 ? importanceDelta : (b.count || 0) - (a.count || 0);
  });
}

function upsertEntry(entries, nextEntry) {
  const existing = entries.find(entry => entry.term === nextEntry.term);
  if (!existing) {
    entries.push(nextEntry);
    return;
  }

  existing.count = Math.max(existing.count || 0, nextEntry.count || 0);
  existing.importance = Math.max(existing.importance || 0, nextEntry.importance || 0);
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termToPattern(term) {
  const aliases = TERM_ALIASES[term] || [term];
  const variants = aliases.map(alias => {
    return escapeRegex(alias)
      .replace(/\s+/g, '\\s+')
      .replace(/\\\./g, '(?:\\\\.|\\\\s*)')
      .replace(/\\\//g, '(?:\\\\/|\\\\s*)');
  });
  return new RegExp(`(^|[^a-z0-9+#])(?:${variants.join('|')})(?=$|[^a-z0-9+#])`, 'gi');
}

function countTermMatches(text = '', term = '') {
  const pattern = termToPattern(term);
  return String(text || '').match(pattern)?.length || 0;
}

function parseRequirementSections(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const sections = [];
  let currentTier = 'context';
  let buffer = [];

  const flush = () => {
    if (buffer.length > 0) {
      sections.push({ tier: currentTier, text: buffer.join('\n') });
      buffer = [];
    }
  };

  for (const line of lines) {
    const heading = REQUIREMENT_HEADING_PATTERNS.find(entry => entry.pattern.test(line));
    if (heading) {
      flush();
      currentTier = heading.tier;
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections.length > 0 ? sections : [{ tier: 'context', text: String(text || '') }];
}

function detectDictionaryKeywords(text, dictionary, category, sections) {
  const results = [];

  for (const term of dictionary) {
    const count = countTermMatches(text, term);
    if (count === 0) continue;

    let importance = 0;
    let explicitRequirement = false;
    const tiers = new Set();

    for (const section of sections) {
      const sectionCount = countTermMatches(section.text, term);
      if (sectionCount === 0) continue;
      const weight = REQUIREMENT_WEIGHTS[section.tier] || REQUIREMENT_WEIGHTS.context;
      importance += sectionCount * weight;
      if (section.tier !== 'context') explicitRequirement = true;
      tiers.add(section.tier);
    }

    if (importance === 0) {
      importance = count * REQUIREMENT_WEIGHTS.context;
    }

    results.push({
      term,
      count,
      category,
      importance: Number(importance.toFixed(2)),
      explicitRequirement,
      tiers: [...tiers],
    });
  }

  return results;
}

function expandTerms(termSet) {
  const expanded = new Set(termSet);

  for (const term of termSet) {
    if (ACRONYMS[term]) expanded.add(ACRONYMS[term]);

    const aliases = TERM_ALIASES[term] || [];
    for (const alias of aliases) expanded.add(alias.toLowerCase());

    for (const [acronym, full] of Object.entries(ACRONYMS)) {
      if (term === full) expanded.add(acronym);
    }
  }

  return expanded;
}

function fuzzyMatch(term, termSet) {
  for (const candidate of termSet) {
    if (candidate === term) return true;
    if (candidate.startsWith(term) || term.startsWith(candidate)) {
      if (Math.abs(candidate.length - term.length) <= 2) return true;
    }
  }
  return false;
}

function categorize(term) {
  if (term === 'r') return 'hard_skill';
  if (HARD_SKILLS.has(term)) return 'hard_skill';
  if (SOFT_SKILLS.has(term)) return 'soft_skill';
  if (CERTIFICATIONS.has(term)) return 'certification';
  return 'other';
}

function isHighSignalSoftSkill(entry = {}) {
  if (!entry?.term) return false;
  if (!LOW_SIGNAL_SOFT_SKILLS.has(entry.term)) return true;
  if (entry.explicitRequirement) return (entry.importance || 0) >= 0.85;
  return (entry.importance || 0) >= 1.35;
}

module.exports = { extractKeywords, matchKeywords };
