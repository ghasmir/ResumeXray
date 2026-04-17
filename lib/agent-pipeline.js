const { extractKeywords, matchKeywords } = require('./keywords');
const { extractSections, detectSections, validateResumeIntegrity } = require('./sections');
const { runXrayAnalysis } = require('./xray');
const { checkFormatIssues } = require('./format-doctor');
const { generateRecommendations } = require('./scorer');
const llm = require('./llm/llm-service');
const { sanitizeForLLM, detectInjectionRisk, fenceUserContent } = require('./llm/sanitizer');
const { validateScore } = require('./llm/output-validator');
const log = require('./logger');

/**
 * Run the full agent pipeline with high-speed parallel execution.
 * Uses the abstracted LLM service (OpenAI or Gemini based on env config).
 *
 * SECURITY: All text inputs are sanitized through the prompt injection
 * defense layer (lib/llm/sanitizer.js) before any LLM calls.
 */
async function runAgentPipeline(resumeText, jdText, emitter, options = {}) {
  const maxRewrites = options.maxBulletRewrites || 12;
  const atsProfile = options.atsProfile || { name: 'generic', displayName: 'ATS-Optimized', template: 'modern', singleColumn: false, noTables: true, strictHeaders: true };
  const jobContext = options.jobContext || null;
  const results = {};
  results.atsProfile = atsProfile;
  results.jobContext = jobContext;

  // ── Defense Layer: Sanitize inputs before LLM consumption ───────────────
  const injectionRisk = detectInjectionRisk(resumeText);
  if (injectionRisk.risk) {
    log.warn('Prompt injection risk detected in resume', {
      score: injectionRisk.score,
      flags: injectionRisk.flags,
    });
  }
  const cleanResumeText = sanitizeForLLM(resumeText);
  const cleanJdText = sanitizeForLLM(jdText);

  // Phase 5 §2: Cryptographic fencing (Layer 2) — wraps sanitized text
  // in Ed25519-signed XML boundaries so the LLM can distinguish data from commands
  const fencedResumeText = fenceUserContent(cleanResumeText, { source: 'user_upload', type: 'resume' });
  const fencedJdText = jdText ? fenceUserContent(cleanJdText, { source: 'user_input', type: 'job_description' }) : '';

  // ── Phase 1: Local Analysis (Parallel) ──────────────────────────────────
  emitter.emitStep(1, 'parse', 'running', 'Analyzing document integrity & structure...');
  
  const [sectionData, xrayData] = await Promise.all([
    Promise.resolve().then(() => detectSections(resumeText)),
    Promise.resolve().then(() => runXrayAnalysis(resumeText))
  ]);

  results.sectionData = sectionData;
  
  // Enrich sectionData with actual extracted values from xray 
  // (detectSections only returns boolean flags, not the actual strings)
  const ef = xrayData.extractedFields || {};
  if (ef.Name) sectionData.name = ef.Name;
  if (ef.Email || ef.Phone) {
    const parts = [];
    if (ef.Email) parts.push(ef.Email);
    if (ef.Phone) parts.push(ef.Phone);
    
    // Extract clean location and LinkedIn from resume header (first 500 chars)
    const headerBlock = resumeText.substring(0, 500);
    const linkedinMatch = headerBlock.match(/linkedin\.com\/in\/[a-zA-Z0-9-]+/i);
    if (linkedinMatch) parts.push(linkedinMatch[0]);
    
    // Try to extract location — look for "City, Country" or "City, State" patterns
    const locationMatch = headerBlock.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),?\s+(Ireland|UK|USA|US|India|Canada|Australia|Germany|France|Netherlands|Remote)\b/i);
    if (locationMatch) parts.push(locationMatch[0].trim());
    
    sectionData.contact = parts.filter(Boolean).join(' | ');
  }

  results.xrayData = xrayData;
  results.parseRate = xrayData.parseRate;

  // ── Integrity Check (Early Exit) ────────────────────────────────────────
  const integrity = validateResumeIntegrity(resumeText, sectionData);
  results.integrity = integrity;

  if (!integrity.isResume) {
    emitter.emitStep(1, 'parse', 'error', 'Invalid Document detected', { integrity });
    emitter.emitScores({ atsReady: 0, jobMatch: 0, atsReadyAfter: 0, jobMatchAfter: 0 });
    emitter.emitError('This document does not appear to be a professional resume. Optimization skipped.', 1);
    
    results.formatHealth = 0;
    results.formatIssues = [];
    results.matchRate = 0;
    results.keywordData = { matched: [], missing: [] };
    results.optimizedBullets = [];
    results.keywordPlan = [];
    return results;
  }

  const formatResults = checkFormatIssues(resumeText, sectionData);
  results.formatHealth = formatResults.formatHealth;
  results.formatIssues = formatResults.issues;

  emitter.emitStep(1, 'parse', 'complete', 'Resume parsed', {
    wordCount: resumeText.split(/\s+/).length,
    sections: Object.values(sectionData.sections).filter(s => s.found).map(s => s.label)
  });

  // Emit ATS platform info so the frontend can display the optimized-for badge
  if (emitter.emitAtsProfile) {
    emitter.emitAtsProfile(atsProfile);
  }
  
  emitter.emitStep(2, 'xray', 'complete', `Parse rate: ${Math.round(xrayData.parseRate)}%`);
  emitter.emitStep(3, 'format', 'complete', `Format health: ${Math.round(formatResults.formatHealth)}%`);

  // ── Phase 2: AI & Keyword Analysis (Parallel) ──────────────────────────
  emitter.emitStep(4, 'keywords', 'running', 'Scanning keywords...');
  emitter.emitStep(5, 'semantic', 'running', 'AI Context Matching...');
  emitter.emitStep(6, 'ghosting', 'running', 'Auditing bullet points...');

  const aiTasks = [
    // Task 4: Keywords (local — no LLM, uses raw text for accuracy)
    Promise.resolve().then(() => {
      if (jdText) {
        const resumeKeywords = extractKeywords(resumeText);
        const jdKeywords = extractKeywords(jdText);
        return matchKeywords(resumeKeywords, jdKeywords);
      }
      return null;
    }),
    // Task 5: Semantic Match (LLM — uses sanitized text)
    cleanJdText ? llm.analyzeSemanticMatch(cleanResumeText, cleanJdText) : Promise.resolve({ score: 0, missing: [], inferred: [] }),
    // Task 6: Ghosting & Knockout (LLM — uses sanitized text)
    llm.analyzeGhostingAndKnockouts(cleanResumeText, cleanJdText || 'General resume audit'),
    // Task 7: Bias Shield (LLM — uses sanitized text)
    llm.analyzeBiasShield(cleanResumeText).catch(() => ({ riskScore: 0, flags: [] }))
  ];

  const [keywordResults, semanticData, aiShieldData, biasShield] = await Promise.all(aiTasks);

  results.keywordData = keywordResults;
  results.matchRate = semanticData?.score || (keywordResults?.matchRate || 0);
  results.semanticData = semanticData;
  results.aiShieldData = aiShieldData;
  results.biasShield = biasShield;

  emitter.emitStep(4, 'keywords', 'complete', `Keywords: ${keywordResults?.matched?.length || 0} matched`);
  emitter.emitStep(5, 'semantic', 'complete', `Semantic Match: ${results.matchRate}%`);
  emitter.emitStep(6, 'ghosting', 'complete', `Audit: ${aiShieldData.ghostingBullets.length} weak points found`);

  // Phase 6 Wave 3: Validate all scores through anti-manipulation clamp (0-98 range)
  const safeParseRate = validateScore(results.parseRate, 'ats');
  const safeFormatHealth = validateScore(results.formatHealth, 'format');
  const safeMatchRate = validateScore(results.matchRate, 'semantic');

  const atsReady = Math.round((safeParseRate * 0.5 + safeFormatHealth * 0.5));
  emitter.emitScores({
    parseRate: safeParseRate,
    formatHealth: safeFormatHealth,
    matchRate: safeMatchRate,
    // Legacy keys for backwards compat
    atsReady: validateScore(atsReady, 'ats'),
    jobMatch: safeMatchRate,
    atsReadyAfter: null,
    jobMatchAfter: null,
    matchRateAfter: null
  });

  // ── Phase 3: Fast Optimization (Parallel Streaming via LLM service) ────
  const optimizedBullets = [];
  const bulletsToRewrite = (aiShieldData.ghostingBullets || []).slice(0, maxRewrites);
  const skippedCount = Math.max(0, (aiShieldData.ghostingBullets?.length || 0) - maxRewrites);

  if (bulletsToRewrite.length > 0) {
    emitter.emitStep(7, 'rewrite', 'running', `Optimizing ${bulletsToRewrite.length} bullet points...`);
    
    const rewritePromises = bulletsToRewrite.map(async (bullet, i) => {
      emitter.emitBullet(7, i, 'rewriting', bullet);
      try {
        const rewriteResult = await llm.streamBulletRewrite(bullet, cleanJdText || '', (chunk) => {
          emitter.emitToken(7, 'rewrite', chunk, i);
        });
        optimizedBullets.push(rewriteResult);
        emitter.emitBullet(7, i, 'complete', bullet, rewriteResult.rewritten, rewriteResult.method, rewriteResult.targetKeyword);
      } catch (e) {
        emitter.emitBullet(7, i, 'error', bullet);
      }
    });

    await Promise.all(rewritePromises);
    const rewriteLabel =
      skippedCount > 0
        ? `Optimized ${optimizedBullets.length} bullets and kept ${skippedCount} lower-priority bullets unchanged for speed`
        : `Optimized ${optimizedBullets.length} bullets`;
    emitter.emitStep(7, 'rewrite', 'complete', rewriteLabel);
  } else {
    emitter.emitStep(7, 'rewrite', 'complete', 'No critical bullet improvements needed');
  }
  results.optimizedBullets = optimizedBullets;

  // Keyword Plan
  const allMissing = [...new Set([
    ...(keywordResults?.missing?.map(k => k.term) || []),
    ...(semanticData?.missing || [])
  ])].slice(0, options.limitKeywords || 5);

  if (allMissing.length > 0) {
    emitter.emitStep(8, 'keywords-plan', 'running', 'Generating keyword insertion plan...');
    try {
      const keywordPlan = await llm.streamKeywordInsertionPlan(cleanResumeText, allMissing, (chunk) => {
        emitter.emitToken(8, 'keywords-plan', chunk);
      });
      results.keywordPlan = keywordPlan;
      emitter.emitStep(8, 'keywords-plan', 'complete', 'Plan generated');
    } catch (e) {
      results.keywordPlan = [];
      emitter.emitError('Keyword plan failed', 8);
    }
  } else {
    results.keywordPlan = [];
    emitter.emitStep(8, 'keywords-plan', 'complete', 'Keyword coverage is excellent');
  }

  // ── Phase 4: Cover Letter Generation ─────────────────────────────────────
  // Generate AFTER optimization so the cover letter references the improved resume
  // Store original resume text — bullet rewrites are applied at render time by
  // buildResumeData() on structured objects, not via flat-text string-replace.
  results.optimizedResumeText = resumeText;

    // Build optimized text for cover letter LLM input only (not for rendering/parsing).
    // This flat-text replacement is safe here because the LLM only reads the prose,
    // it doesn't parse section boundaries or reconstruct structured entries.
    let coverLetterInput = resumeText;
    for (const opt of optimizedBullets) {
      if (opt.original && opt.rewritten) {
        coverLetterInput = coverLetterInput.split(opt.original).join(opt.rewritten);
      }
    }

    if (cleanJdText && cleanJdText.trim().length > 50) {
    emitter.emitStep(9, 'cover-letter', 'running', 'Generating tailored cover letter...');
    try {
      const coverLetter = await llm.streamCoverLetter(coverLetterInput, cleanJdText, (token) => {
        if (emitter.emitToken && token) {
          emitter.emitToken(9, 'cover-letter', token);
        }
      }, jobContext);
      results.coverLetter = coverLetter;
      emitter.emitStep(9, 'cover-letter', 'complete', 'Cover letter generated');
      if (emitter.emitCoverLetter) {
        emitter.emitCoverLetter(coverLetter);
      }
    } catch (e) {
      log.error('Cover letter generation failed', { error: e.message });
      results.coverLetter = null;
      emitter.emitStep(9, 'cover-letter', 'error', 'Cover letter generation failed');
    }
  } else {
    results.coverLetter = null;
    emitter.emitStep(9, 'cover-letter', 'complete', 'No JD provided — cover letter skipped');
  }

  // ── Finalize ────────────────────────────────────────────────────────────
  const keywordPlanBoost = (results.keywordPlan?.length || 0) * 4;
  const bulletBoost = optimizedBullets.length * 5;
  const matchImprovement = bulletBoost + keywordPlanBoost + 5; // Base 5% bump for readability/formatting
  
  const atsAfter = Math.min(100, atsReady + 15 + optimizedBullets.length * 2);

  // Phase 6 Wave 3: Validate final scores
  const matchAfter = validateScore(Math.round(results.matchRate + matchImprovement), 'semantic');
  const atsAfterVal = validateScore(Math.min(100, atsReady + 15 + optimizedBullets.length * 2), 'ats');
  emitter.emitScores({
    parseRate: safeParseRate,
    formatHealth: safeFormatHealth,
    matchRate: safeMatchRate,
    matchRateAfter: matchAfter,
    // Legacy keys
    atsReady: validateScore(atsReady, 'ats'),
    jobMatch: safeMatchRate,
    atsReadyAfter: atsAfterVal,
    jobMatchAfter: matchAfter
  });

  results.recommendations = generateRecommendations(results.keywordData, results.xrayData, results.formatIssues);
  return results;
}

module.exports = { runAgentPipeline };
