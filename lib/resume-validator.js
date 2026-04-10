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

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;

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

  // Signal 1: Email address present (strong resume indicator)
  if (EMAIL_REGEX.test(text)) {
    score += 2;
    signals.push('email');
  }

  // Signal 2: Phone number present
  if (PHONE_REGEX.test(text)) {
    score += 2;
    signals.push('phone');
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

  // Signal 4: Professional action verbs/keywords
  let kwCount = 0;
  for (const kw of PROFESSIONAL_KEYWORDS) {
    if (lower.includes(kw)) kwCount++;
  }
  if (kwCount >= 3) { score += 2; signals.push('professional keywords'); }
  else if (kwCount >= 1) { score += 1; signals.push('some keywords'); }

  // Signal 5: Reasonable length for a resume (200-15000 words)
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 100 && wordCount <= 15000) {
    score += 1;
    signals.push(`${wordCount} words`);
  }

  // Threshold: score >= 4 means it's likely a resume
  const confidence = Math.min(100, Math.round((score / 10) * 100));
  const isResume = score >= 4;

  return {
    isResume,
    confidence,
    reason: isResume
      ? `Resume detected (${signals.join(', ')})`
      : `This doesn't appear to be a resume. Missing typical resume indicators (found: ${signals.join(', ') || 'none'}).`
  };
}

module.exports = { validateResumeContent };
