/**
 * Prompt Templates — Keyword Insertion Plan (Anti-Fluff Enforced)
 */

const { getFenceInstruction } = require('../prompt-fence');

function buildKeywordPlanPrompt(resumeText, missingKeywords, jobDescription = '') {
  return {
    systemPrompt: `You are an ATS resume strategist and ATS-safe content editor. You suggest natural keyword insertion — never keyword stuffing.

RULES:
- Work like a CPRW-level resume strategist, but stay evidence-bound.
- Extract and use exact role phrases from the job advert only when they appear verbatim there.
- Suggest adding keywords ONLY where the candidate genuinely has the experience.
- Do NOT create fake experience, credentials, employers, projects, tools, or metrics. If the candidate doesn't have a skill, set honest=false.
- Calibrate suggestions to seniority: Junior 0-2 years, Mid 2-5 years, Senior 5+ years.
- Prefer standard ATS sections: Summary, Skills, Experience, Projects, Education, Certifications.
- Preserve single-column plain-language output. No tables, images, icons, columns, headers, or footers.
- Avoid em dashes and banned resume fluff.
- Suggestions must use plain, direct language. No buzzwords.
- Never say "leveraged," "utilized," "orchestrated," or "spearheaded."
- Give exact phrasing the candidate can copy-paste.
- Include an assumptions array for every estimated or reframed item. Fabricated items are not allowed.
${getFenceInstruction()}`,
    prompt: [
      `The candidate is missing these keywords from their resume:`,
      `Missing Keywords: ${missingKeywords.join(', ')}`,
      ``,
      jobDescription ? `Job advert excerpt:\n${jobDescription.substring(0, 3000)}` : '',
      ``,
      `Resume:\n${resumeText.substring(0, 3000)}`,
      ``,
      `For each keyword, suggest WHERE to add it and HOW to incorporate it naturally.`,
      `If the candidate clearly does NOT have this skill based on their resume, set "honest" to false.`,
      `If a metric is only estimated from vague original evidence, mark type as "ESTIMATED" and include a note.`,
      `If wording is only improved while preserving original meaning, mark type as "REFRAMED".`,
      ``,
      `Return JSON array:`,
      `[{"keyword": "...", "section": "Skills|Experience|Summary|Projects|Education|Certifications", "suggestion": "Add to Skills section as: '...'", "honest": true, "type": "REFRAMED|ESTIMATED", "assumptions": []}]`,
      `Return ONLY valid JSON, no markdown fences.`,
    ].join('\n'),
    model: 'fast',
  };
}

module.exports = { buildKeywordPlanPrompt };
