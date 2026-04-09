/**
 * Resume section detection.
 *
 * Detects the presence of standard resume sections and validates
 * contact information.
 */

const SECTION_PATTERNS = {
  contact: {
    label: 'Contact Information',
    patterns: [
      /\b(contact|personal\s+info|personal\s+details)\b/i,
    ],
    // Contact is also detected via email/phone presence
    required: true,
  },
  summary: {
    label: 'Professional Summary',
    patterns: [
      /\b(summary|objective|profile|about\s+me|professional\s+summary|career\s+objective|executive\s+summary)\b/i,
    ],
    required: false,
  },
  experience: {
    label: 'Work Experience',
    patterns: [
      /\b(experience|employment|work\s+history|professional\s+experience|career\s+history)\b/i,
    ],
    required: true,
  },
  education: {
    label: 'Education',
    patterns: [
      /\b(education|academic|degree|university|college|school|qualification)\b/i,
    ],
    required: true,
  },
  skills: {
    label: 'Skills',
    patterns: [
      /\b(skills|technical\s+skills|core\s+competencies|competencies|proficiencies|expertise)\b/i,
    ],
    required: true,
  },
  certifications: {
    label: 'Certifications',
    patterns: [
      /\b(certification|certifications|licenses|accreditation|credentials)\b/i,
    ],
    required: false,
  },
  projects: {
    label: 'Projects',
    patterns: [
      /\b(projects|portfolio|key\s+projects|selected\s+projects)\b/i,
    ],
    required: false,
  },
  awards: {
    label: 'Awards & Honors',
    patterns: [
      /\b(awards|honors|achievements|recognition|accomplishments)\b/i,
    ],
    required: false,
  },
  volunteer: {
    label: 'Volunteer Experience',
    patterns: [
      /\b(volunteer|community\s+service|pro\s+bono|civic)\b/i,
    ],
    required: false,
  },
  publications: {
    label: 'Publications',
    patterns: [
      /\b(publications|papers|research|journal|conference)\b/i,
    ],
    required: false,
  },
};

/**
 * Detect which standard sections are present in the resume text.
 * Also validates contact information.
 */
function detectSections(resumeText) {
  const text = resumeText.toLowerCase();
  const sections = {};
  let foundCount = 0;
  let requiredCount = 0;
  let requiredFound = 0;

  for (const [key, config] of Object.entries(SECTION_PATTERNS)) {
    const found = config.patterns.some((p) => p.test(text));
    sections[key] = {
      label: config.label,
      found,
      required: config.required,
    };
    if (found) foundCount++;
    if (config.required) {
      requiredCount++;
      if (found) requiredFound++;
    }
  }

  // Special handling: contact detection via email / phone
  const contactInfo = detectContactInfo(resumeText);
  if (contactInfo.hasEmail || contactInfo.hasPhone) {
    if (!sections.contact.found) {
      foundCount++;
      requiredFound++;
    }
    sections.contact.found = true;
  }

  return {
    sections,
    contactInfo,
    totalSections: Object.keys(SECTION_PATTERNS).length,
    foundCount,
    requiredCount,
    requiredFound,
    sectionScore: requiredCount > 0 ? Math.round((requiredFound / requiredCount) * 100) : 100,
  };
}

/**
 * Detect contact information in resume text.
 */
function detectContactInfo(text) {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/;
  const linkedinRegex = /linkedin\.com\/in\/[a-zA-Z0-9\-]+/i;
  const githubRegex = /github\.com\/[a-zA-Z0-9\-]+/i;
  const websiteRegex = /https?:\/\/[^\s]+/i;

  return {
    hasEmail: emailRegex.test(text),
    hasPhone: phoneRegex.test(text),
    hasLinkedIn: linkedinRegex.test(text),
    hasGitHub: githubRegex.test(text),
    hasWebsite: websiteRegex.test(text),
  };
}

/**
 * Analyze formatting issues that may cause ATS problems.
 */
function analyzeFormat(resumeText) {
  const issues = [];
  const warnings = [];

  // Check for common ATS-unfriendly elements
  if (/[│┤├┬┴┼╔╗╚╝║═]/.test(resumeText)) {
    issues.push({
      type: 'tables',
      message: 'Resume appears to contain table characters which many ATS systems cannot parse.',
      severity: 'high',
    });
  }

  if (/[★☆●◆▪▸►◗⬡✦]/.test(resumeText)) {
    issues.push({
      type: 'special_chars',
      message: 'Special characters/symbols detected. Use standard bullet points (•, -, *) instead.',
      severity: 'medium',
    });
  }

  // Check resume length (word count)
  const wordCount = resumeText.split(/\s+/).length;
  if (wordCount < 150) {
    warnings.push({
      type: 'too_short',
      message: `Resume is very short (≈${wordCount} words). Aim for 400-800 words for a strong resume.`,
      severity: 'high',
    });
  } else if (wordCount > 1500) {
    warnings.push({
      type: 'too_long',
      message: `Resume is quite long (≈${wordCount} words). Consider trimming to under 1000 words for better ATS scanning.`,
      severity: 'low',
    });
  }

  // Check for action verbs
  const actionVerbs = [
    'achieved','managed','led','developed','created','implemented','designed',
    'improved','increased','reduced','delivered','launched','built','drove',
    'optimized','streamlined','spearheaded','orchestrated','transformed',
    'generated','established','coordinated','executed','negotiated',
  ];
  const lower = resumeText.toLowerCase();
  const verbs = actionVerbs.filter((v) => lower.includes(v));
  if (verbs.length < 3) {
    warnings.push({
      type: 'few_action_verbs',
      message: 'Use more action verbs (e.g., achieved, developed, implemented) to strengthen your bullet points.',
      severity: 'medium',
    });
  }

  // Check for quantified results
  const numberPattern = /\d+%|\$[\d,]+|\d+x|\d+\+/g;
  const quantified = (resumeText.match(numberPattern) || []).length;
  if (quantified < 2) {
    warnings.push({
      type: 'few_metrics',
      message: 'Add more quantified results (e.g., "increased revenue by 25%", "managed team of 12").',
      severity: 'medium',
    });
  }

  const formatScore = Math.max(0, 100 - issues.length * 15 - warnings.length * 5);

  return {
    issues,
    warnings,
    wordCount,
    actionVerbCount: verbs.length,
    quantifiedResults: quantified,
    formatScore,
  };
}

/**
 * Extract actual section text for X-Ray visualizations
 */
function extractSections(text) {
  const sections = { Contact: {} };
  let currentSection = null;
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 30 && trimmed === trimmed.toUpperCase()) {
      if (trimmed.includes('EXPERIENCE')) currentSection = 'Experience';
      else if (trimmed.includes('EDUCATION')) currentSection = 'Education';
      else if (trimmed.includes('SKILLS')) currentSection = 'Skills';
      else if (trimmed.includes('SUMMARY') || trimmed.includes('PROFILE')) currentSection = 'Summary';
      else currentSection = trimmed; // Custom header
    }

    if (currentSection && !trimmed.includes(currentSection.toUpperCase())) {
      if (!sections[currentSection]) sections[currentSection] = '';
      sections[currentSection] += trimmed + '\n';
    }
  }

  return sections;
}

function extractContactInfo(text) {
  const contact = {};
  const first10Lines = text.split('\n').slice(0, 10).join('\n');
  const emailMatch = first10Lines.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) contact.email = emailMatch[0];
  
  const phoneMatch = first10Lines.match(/(?:\+?\d{1,3}\s?)?(?:\(\d{1,4}\)|\d{1,4})(?:[-.\s]?\d{1,4}){2,}/);
  if (phoneMatch) contact.phone = phoneMatch[0];

  // Extract name: First non-empty line that isn't email, phone, URL, or section header
  const headerLines = first10Lines.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (const line of headerLines) {
    if (line.match(/[@.]\S+\.\S+/) || line.match(/\d{3,}/) || line.match(/http|www\./i)) continue;
    if (line.length > 60) continue;
    if (line.match(/^(EXPERIENCE|EDUCATION|SKILLS|SUMMARY|PROFILE|OBJECTIVE|CONTACT|ADDRESS)/i)) continue;
    contact.name = line;
    break;
  }
  
  return contact;
}

/**
 * Validate if the text actually looks like a professional resume.
 * Returns { isResume: boolean, score: number, issues: string[] }
 */
function validateResumeIntegrity(resumeText, sectionData) {
  const issues = [];
  let score = 100;

  // 1. Check for contact info (Essential)
  if (!sectionData.contactInfo.hasEmail && !sectionData.contactInfo.hasPhone) {
    issues.push('Missing contact information (Email/Phone)');
    score -= 40;
  }

  // 2. Check for core sections (Experience, Education, Skills)
  const coreSections = ['experience', 'education', 'skills'];
  const missingCore = coreSections.filter(s => !sectionData.sections[s].found);
  if (missingCore.length > 0) {
    issues.push(`Missing core sections: ${missingCore.join(', ')}`);
    score -= (missingCore.length * 15);
  }

  // 3. Word count check
  const wordCount = resumeText.split(/\s+/).length;
  if (wordCount < 100) {
    issues.push(`Document is too short (${wordCount} words) to be a professional resume.`);
    score -= 30;
  }

  // 4. Lorem Ipsum / Placeholder check
  if (/lorem ipsum|dolor sit amet|consectetuer adipiscing/i.test(resumeText)) {
    issues.push('Placeholder text (Lorem Ipsum) detected.');
    score -= 80;
  }

  return {
    isResume: score >= 30,
    score: Math.max(0, score),
    issues
  };
}

module.exports = { detectSections, analyzeFormat, extractSections, extractContactInfo, validateResumeIntegrity };
