/**
 * Keyword extraction and matching engine.
 *
 * Uses TF-IDF-like scoring with built-in skill dictionaries
 * to find relevant keywords and compare resume ↔ JD coverage.
 */

// ── Skill Dictionaries ──────────────────────────────────────────────────────

const HARD_SKILLS = new Set([
  // Programming
  'javascript','typescript','python','java','c++','c#','ruby','go','golang','rust',
  'swift','kotlin','php','scala','r','matlab','perl','sql','nosql','graphql',
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

/**
 * Extract keywords from text using TF frequency and skill dictionaries.
 * Returns an object with categorised keywords.
 */
function extractKeywords(text) {
  const lower = text.toLowerCase();
  const words = tokenize(lower);

  // Count term frequency
  const freq = {};
  for (const w of words) {
    if (!STOP_WORDS.has(w) && w.length > 1) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  // Also look for multi-word skill matches
  const multiWordMatches = findMultiWordSkills(lower);
  for (const mw of multiWordMatches) {
    freq[mw] = (freq[mw] || 0) + 1;
  }

  const hardSkills = [];
  const softSkills = [];
  const certifications = [];
  const otherKeywords = [];

  for (const [term, count] of Object.entries(freq)) {
    const entry = { term, count };

    if (HARD_SKILLS.has(term)) {
      hardSkills.push(entry);
    } else if (SOFT_SKILLS.has(term)) {
      softSkills.push(entry);
    } else if (CERTIFICATIONS.has(term)) {
      certifications.push(entry);
    } else if (count >= 2 && term.length > 2) {
      // Include recurring terms as "other" keywords
      otherKeywords.push(entry);
    }
  }

  // Sort each category by frequency desc
  const sort = (arr) => arr.sort((a, b) => b.count - a.count);

  return {
    hardSkills: sort(hardSkills),
    softSkills: sort(softSkills),
    certifications: sort(certifications),
    otherKeywords: sort(otherKeywords).slice(0, 30), // cap
    allTerms: freq,
  };
}

/**
 * Match resume keywords against JD keywords.
 * Returns matched, missing, and stats.
 */
function matchKeywords(resumeKeywords, jdKeywords) {
  const resumeAll = new Set(Object.keys(resumeKeywords.allTerms));
  const jdAll = new Set(Object.keys(jdKeywords.allTerms));

  // Build expanded sets (include acronym variants)
  const resumeExpanded = expandTerms(resumeAll);
  const jdExpanded = expandTerms(jdAll);

  // Match JD keywords against resume
  const matched = [];
  const missing = [];

  const jdImportant = [
    ...jdKeywords.hardSkills,
    ...jdKeywords.softSkills,
    ...jdKeywords.certifications,
  ];

  for (const kw of jdImportant) {
    const t = kw.term;
    if (resumeExpanded.has(t) || fuzzyMatch(t, resumeExpanded)) {
      matched.push({ ...kw, category: categorize(t) });
    } else {
      missing.push({ ...kw, category: categorize(t) });
    }
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
  return text
    .replace(/[^a-z0-9#+.\-/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function findMultiWordSkills(text) {
  const found = [];
  const allSkills = [...HARD_SKILLS, ...SOFT_SKILLS, ...CERTIFICATIONS];
  for (const skill of allSkills) {
    if (skill.includes(' ') && text.includes(skill)) {
      found.push(skill);
    }
  }
  return found;
}

function expandTerms(termSet) {
  const expanded = new Set(termSet);
  for (const t of termSet) {
    if (ACRONYMS[t]) expanded.add(ACRONYMS[t]);
    // Reverse lookup
    for (const [acr, full] of Object.entries(ACRONYMS)) {
      if (t === full) expanded.add(acr);
    }
  }
  return expanded;
}

function fuzzyMatch(term, termSet) {
  // Simple substring / plural match
  for (const t of termSet) {
    if (t === term) return true;
    if (t.startsWith(term) || term.startsWith(t)) {
      if (Math.abs(t.length - term.length) <= 2) return true;
    }
  }
  return false;
}

function categorize(term) {
  if (HARD_SKILLS.has(term)) return 'hard_skill';
  if (SOFT_SKILLS.has(term)) return 'soft_skill';
  if (CERTIFICATIONS.has(term)) return 'certification';
  return 'other';
}

module.exports = { extractKeywords, matchKeywords };
