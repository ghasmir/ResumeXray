// lib/xray.js

const { extractSections, extractContactInfo } = require('./sections');

/**
 * ATS X-Ray Engine
 * Simulates how different ATS parsers read a resume and identifies broken field extractions.
 * 
 * In a full production environment, this would call out to multiple robust NLP models.
 * Here we simulate it by applying strict vs lenient parsing heuristics to show what a 
 * "dumb" text-only parser sees vs a "smarter" semantic parser.
 */
function runXrayAnalysis(rawText) {
  const xrayData = {
    engines: {},
    fieldAccuracy: {},
    parseRate: 0,
    extractedFields: {}
  };

  // 1. "Dumb Text Parser" (Simulates legacy systems with bad OCR or basic extraction)
  const legacyExtraction = simulateLegacyParser(rawText);
  xrayData.engines.legacyTextParser = legacyExtraction;

  // 2. "Structured Field Mapper" (Simulates Workday-style strict section heuristics)
  const structuredExtraction = simulateStructuredParser(rawText);
  xrayData.engines.structuredParser = structuredExtraction;

  // 3. "Our Enhanced Parser" (Best case scenario, what we extracted)
  const bestCaseExtraction = extractSections(rawText);
  bestCaseExtraction.Contact = extractContactInfo(rawText);
  xrayData.engines.enhancedParser = bestCaseExtraction;

  // 4. Calculate Field Accuracy & Parse Rate
  // We compare the best case scenario with the strict structured parser to see what "broke".
  const expectedFields = ['Name', 'Email', 'Phone', 'Location', 'LinkedIn', 'Summary', 'Experience', 'Education', 'Skills'];
  let successfulExtractions = 0;

  expectedFields.forEach(field => {
    let status = 'missing'; // red
    let extractedValue = null;

    if (['Name', 'Email', 'Phone', 'Location', 'LinkedIn'].includes(field)) {
      extractedValue = structuredExtraction.Contact && structuredExtraction.Contact[field.toLowerCase()];
      if (extractedValue) {
        status = 'success'; // green
        successfulExtractions++;
      }
    } else {
      extractedValue = structuredExtraction[field];
      if (extractedValue && extractedValue.length > 50) {
        status = 'success';
        successfulExtractions++;
      } else if (extractedValue && extractedValue.length > 0) {
        status = 'warning'; // yellow (partially parsed)
        successfulExtractions += 0.5;
      }
    }

    xrayData.fieldAccuracy[field] = {
      status,
      value: extractedValue || '[Parser could not extract this field. Ensure it is not in a table or header.]'
    };
    
    xrayData.extractedFields[field] = extractedValue || '';
  });

  xrayData.parseRate = Math.round((successfulExtractions / expectedFields.length) * 100);

  return xrayData;
}

// Helper: Simulate a legacy text-only parser that struggles with layouts
function simulateLegacyParser(text) {
  // Simulates line breaks disappearing due to bad bounding boxes
  return text.replace(/\n{2,}/g, '  ').replace(/ {4,}/g, ' '); 
}

// Helper: Simulate a rigid structure parser (like old Workday or Taleo)
function simulateStructuredParser(text) {
  const sections = { Contact: {} };
  
  // Extract contact info but rigidly at the very start (first 500 chars)
  const headerText = text.substring(0, 500);

  // Name: ATS parsers typically grab the FIRST non-empty, non-email, non-phone line
  // This simulates how Workday/Taleo/iCIMS extract the candidate name
  const headerLines = headerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (const line of headerLines) {
    // Skip lines that look like emails, phones, URLs, or section headers
    if (line.match(/@\S+\.\S+/)) continue;           // email
    if (line.match(/\d{5,}/)) continue;               // phone/zip (5+ consecutive digits)
    if (line.match(/http|www\.|linkedin/i)) continue;  // URLs
    if (line.length > 60) continue;                    // Names are short
    if (line.match(/^(EXPERIENCE|EDUCATION|SKILLS|SUMMARY|PROFILE|OBJECTIVE|CONTACT|ADDRESS)/i)) continue;
    // This line is likely the name
    sections.Contact.name = line;
    break;
  }

  const emailMatch = headerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) sections.Contact.email = emailMatch[0];

  const linkedinMatch = headerText.match(/linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  if (linkedinMatch) sections.Contact.linkedin = linkedinMatch[0];

  // Location: "City, State/Country" patterns
  const locationMatch = headerText.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*),?\s+([A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/);
  if (locationMatch) sections.Contact.location = locationMatch[0].trim();

  const phoneMatch = headerText.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{2,4}[\s.-]\d{2,4}(?:[\s.-]\d{1,5})?/);
  if (phoneMatch) sections.Contact.phone = phoneMatch[0];

  // Common section keywords and their regex patterns
  const sectionPatterns = {
    Experience: /(?:EXPERIENCE|WORK HISTORY|EMPLOYMENT|PROFESSIONAL EXPERIENCE)/i,
    Education: /(?:EDUCATION|ACADEMIC|QUALIFICATIONS)/i,
    Skills: /(?:SKILLS|CORE COMPETENCIES|TECHNOLOGIES|TECHNICAL SKILLS|STRENGTHS)/i,
    Summary: /(?:SUMMARY|PROFILE|OBJECTIVE|ABOUT ME|ABOUT|CAREER OBJECTIVE|PROFESSIONAL SUMMARY|CAREER PROFILE)/i,
    Projects: /(?:PROJECTS|PERSONAL PROJECTS|KEY PROJECTS)/i
  };

  // Find where the first section header starts to skip the contact block
  const lines = text.split('\n');
  let firstSectionLine = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0 || line.length > 50) continue;
    for (const [, pattern] of Object.entries(sectionPatterns)) {
      if (pattern.test(line)) {
        firstSectionLine = i;
        break;
      }
    }
    if (firstSectionLine < Infinity) break;
  }

  let currentSection = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    // Skip contact block lines (before first section header)
    if (i < firstSectionLine) continue;

    // Check if line looks like a header (short, maybe uppercase, matches pattern)
    if (line.length <= 50) {
      let foundSection = null;
      for (const [key, pattern] of Object.entries(sectionPatterns)) {
        if (pattern.test(line)) {
          // Strictness simulation: many ATS fail if headers have icons or weird spacing
          const hasIcons = /[^\x00-\x7F]/.test(line);
          if (hasIcons) continue; // Strict parser deterministically fails on non-ASCII headers
          foundSection = key;
          break;
        }
      }

      if (foundSection) {
        currentSection = foundSection;
        if (!sections[currentSection]) sections[currentSection] = '';
        continue;
      }
    }

    if (currentSection) {
      // Clean MONTH placeholder boilerplate from dates
      const cleanedLine = line.replace(/\bMONTH\b/g, 'Jan');
      sections[currentSection] += cleanedLine + '\n';
    }
  }

  return sections;
}

module.exports = { runXrayAnalysis };
