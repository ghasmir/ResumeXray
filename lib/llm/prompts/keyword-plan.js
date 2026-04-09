/**
 * Prompt Templates — Keyword Insertion Plan (Anti-Fluff Enforced)
 */

const { getFenceInstruction } = require('../prompt-fence');

function buildKeywordPlanPrompt(resumeText, missingKeywords) {
  return {
    systemPrompt: `You are an ATS resume optimizer. You suggest natural keyword insertion — never keyword stuffing.

RULES:
- Suggest adding keywords ONLY where the candidate genuinely has the experience.
- Do NOT create fake experience. If the candidate doesn't have a skill, say so.
- Suggestions must use plain, direct language. No buzzwords.
- Never say "leveraged," "utilized," "orchestrated," or "spearheaded."
- Give exact phrasing the candidate can copy-paste.
${getFenceInstruction()}`,
    prompt: [
      `The candidate is missing these keywords from their resume:`,
      `Missing Keywords: ${missingKeywords.join(', ')}`,
      ``,
      `Resume:\n${resumeText.substring(0, 3000)}`,
      ``,
      `For each keyword, suggest WHERE to add it and HOW to incorporate it naturally.`,
      `If the candidate clearly does NOT have this skill based on their resume, set "honest" to false.`,
      ``,
      `Return JSON array:`,
      `[{"keyword": "...", "section": "Skills|Experience|Summary", "suggestion": "Add to Skills section as: '...'", "honest": true}]`,
      `Return ONLY valid JSON, no markdown fences.`,
    ].join('\n'),
    model: 'fast',
  };
}

module.exports = { buildKeywordPlanPrompt };
