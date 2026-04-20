/**
 * Resume Content Validator — Lightweight heuristic
 *
 * Checks if extracted text looks like a resume rather than an arbitrary document.
 * Uses signal-based scoring: email, phone, section headers, professional keywords.
 *
 * Returns { isResume: boolean, confidence: number, reason: string }
 */

// Common resume section headers (case-insensitive)
const RESUME_SECTIONS = [
  'experience', 'education', 'skills', 'work experience', 'professional experience',
  'employment', 'qualifications', 'certifications', 'projects', 'summary',
  'objective', 'profile', 'technical skills', 'achievements', 'awards',
  'training', 'internship', 'volunteer', 'publications', 'references',
  'competencies', 'languages', 'interests', 'professional summary',
  'career objective', 'work history', 'academic',
];

// Professional keywords that signal resume content
const PROFESSIONAL_KEYWORDS = [
  'managed', 'developed', 'implemented', 'designed', 'led', 'created',
  'responsible for', 'collaborated', 'analyzed', 'improved', 'optimized',
  'bachelor', 'master', 'degree', 'university', 'college', 'gpa',
  'resume', 'curriculum vitae', 'cv',
];

const NEGATIVE_DOCUMENT_SIGNALS = [
  'invoice',
  'purchase order',
  'quotation',
  'statement of work',
  'terms and conditions',
  'privacy policy',
  'board meeting',
  'meeting minutes',
  'research paper',
  'proposal',
  'contract',
  'nda',
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;
const PROFILE_REGEX = /\b(linkedin|github|portfolio|behance|dribbble)\b/i;
const DATE_RANGE_REGEX =
  /\b(?:\d{1,2}\/\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\d{4})\s*(?:-|–|—|to)\s*(?:present|current|\d{1,2}\/\d{4}|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4})\b/i;
const BULLET_LINE_REGEX = /(?:^|\n)\s*[•\-*]\s+\S+/g;

/**
 * @param {string} text - Extracted text from uploaded file
 * @returns {{ isResume: boolean, confidence: number, reason: string }}
 */
function validateResumeContent(text) {
  if (!text || text.trim().length < 50) {
    return { isResume: false, confidence: 0, reason: 'File contains too little text.' };
  }

  const lower = text.toLowerCase();
  let score = 0;
  const signals = [];
  const hasEmail = EMAIL_REGEX.test(text);
  const hasPhone = PHONE_REGEX.test(text);
  const hasProfile = PROFILE_REGEX.test(text);

  // Signal 1: Email address present (strong resume indicator)
  if (hasEmail) {
    score += 2;
    signals.push('email');
  }

  // Signal 2: Phone number present
  if (hasPhone) {
    score += 2;
    signals.push('phone');
  }

  if (hasProfile) {
    score += 1;
    signals.push('profile');
  }

  // Signal 3: Resume section headers found
  let sectionCount = 0;
  for (const section of RESUME_SECTIONS) {
    // Look for section headers: standalone line or followed by colon/newline
    const regex = new RegExp(`(?:^|\\n)\\s*${section}\\s*[:\\n|]`, 'i');
    if (regex.test(text)) {
      sectionCount++;
      if (sectionCount <= 3) score += 2; // Diminishing returns after 3
      else score += 0.5;
    }
  }
  if (sectionCount > 0) signals.push(`${sectionCount} sections`);

  // Signal 4: Resume-style date ranges
  const dateMatches = text.match(new RegExp(DATE_RANGE_REGEX, 'g')) || [];
  if (dateMatches.length > 0) {
    score += Math.min(2, dateMatches.length);
    signals.push(`${dateMatches.length} date ranges`);
  }

  // Signal 5: Bullet-heavy experience/project content
  const bulletCount = (text.match(BULLET_LINE_REGEX) || []).length;
  if (bulletCount >= 2) {
    score += 1.5;
    signals.push(`${bulletCount} bullet lines`);
  }

  // Signal 6: Professional action verbs/keywords
  let kwCount = 0;
  for (const kw of PROFESSIONAL_KEYWORDS) {
    if (lower.includes(kw)) kwCount++;
  }
  if (kwCount >= 3) { score += 2; signals.push('professional keywords'); }
  else if (kwCount >= 1) { score += 1; signals.push('some keywords'); }

  let negativeHits = 0;
  for (const signal of NEGATIVE_DOCUMENT_SIGNALS) {
    if (lower.includes(signal)) negativeHits++;
  }
  if (negativeHits > 0) {
    score -= Math.min(4, negativeHits * 1.5);
    signals.push(`${negativeHits} non-resume signals`);
  }

  // Signal 7: Reasonable length for a resume (200-15000 words)
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 100 && wordCount <= 15000) {
    score += 1;
    signals.push(`${wordCount} words`);
  }

  const hasContactSignal = hasEmail || hasPhone || hasProfile;
  const hasStructureSignal = sectionCount > 0 || dateMatches.length > 0 || bulletCount >= 2;
  const confidence = Math.max(0, Math.min(100, Math.round((score / 12) * 100)));
  const isResume = score >= 5 && hasContactSignal && hasStructureSignal;

  return {
    isResume,
    confidence,
    reason: isResume
      ? `Resume detected (${signals.join(', ')})`
      : `This doesn't appear to be a resume. Missing typical resume indicators (found: ${signals.join(', ') || 'none'}).`
  };
}

module.exports = { validateResumeContent };
