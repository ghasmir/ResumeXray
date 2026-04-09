// lib/format-doctor.js

/**
 * Heuristics to detect parser-killing format issues from raw text and extracted metadata.
 * Returns an array of issues with severity and fix suggestions.
 */
function checkFormatIssues(rawText, parsedSections) {
  const issues = [];
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Image-based PDF check (Empty text)
  if (rawText.length < 50) {
    return [{
      id: 'image_pdf',
      title: 'Image-Based PDF Detected',
      severity: 'high',
      message: 'The parser found almost no text. This usually means your resume is a scanned image or flattened graphic.',
      fix: 'Save your resume directly from your word processor as a text-based PDF or .docx file.'
    }];
  }

  // 2. Multi-column layout heuristic
  // Looks for lines with large gaps of continuous spaces (e.g. "Experience            Education")
  const multiColumnRegex = / {10,}/;
  const multiColumnLines = lines.filter(l => multiColumnRegex.test(l)).length;
  if (multiColumnLines > 3) {
    issues.push({
      id: 'multi_column',
      title: 'Multi-Column Layout Detected',
      severity: 'high',
      message: 'We detected large horizontal gaps, suggesting a multi-column layout. Parsers often merge these columns together, scrambling your experience.',
      fix: 'Use a single-column, top-to-bottom layout for maximum ATS readability.'
    });
  }

  // 3. Non-standard section headers
  const standardHeaders = ['experience', 'work history', 'education', 'skills', 'projects', 'summary', 'profile'];
  const foundHeaders = Object.keys(parsedSections).map(h => h.toLowerCase());
  const nonStandard = foundHeaders.filter(h => !standardHeaders.some(std => h.includes(std) || std.includes(h)));
  
  if (nonStandard.length > 0 && foundHeaders.length > 0) {
    issues.push({
      id: 'custom_headers',
      title: 'Non-Standard Section Headers',
      severity: 'medium',
      message: `You are using creative or unrecognized section headers: "${nonStandard.join('", "')}". The ATS might fail to map your experiences correctly.`,
      fix: 'Rename your headers to standard industry terms like "Work Experience", "Education", and "Skills".'
    });
  } else if (foundHeaders.length === 0) {
    issues.push({
      id: 'missing_headers',
      title: 'Missing Section Headers',
      severity: 'high',
      message: 'The parser could not identify standard sections (e.g., Work Experience, Education).',
      fix: 'Ensure your section headers are clearly capitalized and use standard terms (e.g., "EXPERIENCE"). Avoid placing them in tables or text boxes.'
    });
  }

  // 4. Inconsistent date formats
  const dateRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (?:19|20)\d{2}\b|\b(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}\b/gi;
  const dates = rawText.match(dateRegex) || [];
  
  let hasAlphaDates = dates.some(d => /[a-z]/i.test(d));
  let hasNumericDates = dates.some(d => /\//.test(d));
  
  if (hasAlphaDates && hasNumericDates) {
    issues.push({
      id: 'mixed_dates',
      title: 'Inconsistent Date Formatting',
      severity: 'medium',
      message: 'We found mixed date formats (e.g., "Jan 2022" and "01/2022"). This can confuse the parser\'s timeline calculations.',
      fix: 'Choose one format (e.g., MM/YYYY or Month YYYY) and use it consistently throughout your work history.'
    });
  }

  // 5. Contact info in Header/Footer (Heuristic: missing contact info)
  // If the parsed sections object doesn't have a contact/header section, or it's empty
  if (!parsedSections.Contact || Object.keys(parsedSections.Contact).length === 0) {
    issues.push({
      id: 'hidden_contact',
      title: 'Missing Contact Information',
      severity: 'high',
      message: 'We could not extract an email address or phone number. If it is located in the document header or footer, the ATS might be ignoring it.',
      fix: 'Move your contact information into the main body of the document, at the very top.'
    });
  }

  // 6. Excessive Capitalization (ALL CAPS overuse)
  const allCapsLines = lines.filter(l => l.length > 15 && l === l.toUpperCase()).length;
  if (allCapsLines > (lines.length * 0.1) && lines.length > 10) { // More than 10% of lines are ALL CAPS
    issues.push({
      id: 'excessive_caps',
      title: 'Excessive Capitalization',
      severity: 'low',
      message: 'A significant portion of your resume is in ALL CAPS. While not a parser-killer, it can hurt readability and sometimes cause tokenization issues during semantic matching.',
      fix: 'Reserve ALL CAPS solely for top-level section headers or your name.'
    });
  }

  // 7. Garbled text / Font encoding issues
  // Look for highly unusual characters that often stem from bad PDF font embedding
  const garbledRegex = /[\uFFFD]/;
  if (garbledRegex.test(rawText)) {
    issues.push({
      id: 'garbled_text',
      title: 'Font Encoding Issues',
      severity: 'high',
      message: 'We detected unrecognized characters (). This usually means you used a non-standard font or the PDF wasn\'t flattened properly, causing the ATS to see gibberish.',
      fix: 'Switch your font to standard web-safe fonts like Arial, Calibri, or Times New Roman, and re-export the PDF.'
    });
  }

  // Provide a clean format health score based on issues
  const severityWeights = { high: 20, medium: 10, low: 5 };
  const totalPenalty = issues.reduce((acc, issue) => acc + severityWeights[issue.severity], 0);
  const formatHealth = Math.max(0, 100 - totalPenalty);

  return { formatHealth, issues };
}

module.exports = { checkFormatIssues };
