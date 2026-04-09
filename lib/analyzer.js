/**
 * ATS Analysis Engine — orchestrates the full pipeline.
 */

const { extractKeywords, matchKeywords } = require('./keywords');
const { extractSections } = require('./sections');
const { runXrayAnalysis } = require('./xray');
const { checkFormatIssues } = require('./format-doctor');
const { generateRecommendations } = require('./scorer');
const llm = require('./llm/llm-service');
const log = require('./logger');

/**
 * Run the full ATS analysis on a resume against a job description.
 *
 * @param {string} resumeText  — plain text extracted from resume
 * @param {string} jdText      — job description text (optional)
 * @returns {Promise<object>}           — comprehensive results
 */
async function analyzeResume(resumeText, jdText = '') {
  // 1. Run ATS X-Ray (Field extraction simulation)
  const xrayData = runXrayAnalysis(resumeText);

  // 2. Parse sections for Format Doctor heuristics
  const parsedSections = extractSections(resumeText);

  // 3. Format Doctor
  const formatResults = checkFormatIssues(resumeText, parsedSections);
  const formatHealth = formatResults.formatHealth;
  const formatIssues = formatResults.issues;

  // 4. Keyword Match & Semantic Match & Ghosting (if JD is provided)
  let keywordResults = null;
  let matchRate = null;
  let semanticData = null;
  let aiShieldData = { ghostingBullets: [], knockoutRisks: [] };
  
  if (jdText) {
    const resumeKeywords = extractKeywords(resumeText);
    const jdKeywords = extractKeywords(jdText);
    keywordResults = matchKeywords(resumeKeywords, jdKeywords);
    matchRate = keywordResults.matchRate;
    
    // OVERRIDE with Semantic Score
    semanticData = await llm.analyzeSemanticMatch(resumeText, jdText);
    if (semanticData && semanticData.score) {
      matchRate = semanticData.score;
    }
  }

  // Always run ghosting/knockout analysis (works with or without JD)
  try {
    aiShieldData = await llm.analyzeGhostingAndKnockouts(resumeText, jdText || 'No specific job description provided. Analyze the resume bullet points for general weakness: lack of metrics, passive language, vague duties without measurable outcomes.');
  } catch (e) {
    log.warn('AI Shield analysis failed', { error: e.message });
  }

  // 5. Run Algorithmic Bias Shield
  const biasShield = await llm.analyzeBiasShield(resumeText);

  // 6. Generate recommendations based on the combined output
  const recommendations = generateRecommendations(
    keywordResults,
    xrayData,
    formatIssues
  );

  return {
    parseRate: xrayData.parseRate,
    formatHealth: formatHealth,
    matchRate: matchRate,
    semanticData,
    biasShield,
    aiShieldData,
    xrayData: xrayData,
    formatIssues: formatIssues,
    keywordData: keywordResults,
    sectionData: parsedSections,
    recommendations,
  };
}

module.exports = { analyzeResume };
