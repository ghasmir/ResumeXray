/**
 * Prompt Templates — Ghosting Predictor & Knockout Shield
 * Includes strict date-awareness to prevent false "future date" flags.
 */

const { getFenceInstruction } = require('../prompt-fence');

function buildGhostingKnockoutPrompt(resumeText, jobDescription) {
  const now = new Date();
  const today = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  return {
    systemPrompt: `You are a highly critical Tier-1 Tech Recruiter and ATS Auditor. Your goal is to find EVERY reason a candidate might be ghosted or auto-rejected.
${getFenceInstruction()}`,
    prompt: [
      `CRITICAL DATE CONTEXT:`,
      `Today's date is: ${today} (${String(currentMonth).padStart(2, '0')}/${currentYear})`,
      `Any date before ${String(currentMonth).padStart(2, '0')}/${currentYear} is in the PAST.`,
      `For example: February 2026 is in the PAST if today is March 2026.`,
      `January 2026, December 2025, etc. are ALL in the past.`,
      `Only flag dates that are GENUINELY in the future (after ${today}).`,
      `DO NOT flag employment end dates that are in the past or "Present" as future dates.`,
      ``,
      `Analyze for:`,
      ``,
      `1. **Ghosting Risk:** Weak bullet points that:`,
      `   - Lack hard metrics (%, $, numbers, timeframes)`,
      `   - Use passive verbs (responsible for, assisted, helped)`,
      `   - Describe duties instead of achievements`,
      `   - Are vague without Challenge or Result context`,
      ``,
      `2. **Knockout Shield:** Categorical mismatches for instant rejection:`,
      `   - Missing mandatory degree/certification`,
      `   - Years of experience significantly below JD requirement`,
      `   - Missing "Must have" / "Required" hard skills`,
      `   - Location mismatches or shift requirements`,
      ``,
      `Resume:\n${resumeText.substring(0, 4000)}`,
      ``,
      `Job Description:\n${(jobDescription || 'General resume audit').substring(0, 4000)}`,
      ``,
      `Return JSON:`,
      `{"ghostingBullets": ["exact original text of weak bullets"], "knockoutRisks": ["clear explanations of auto-reject risks"]}`,
      ``,
      `Return ONLY valid JSON. Be extremely critical. Capture exact original text.`,
    ].join('\n'),
    model: 'fast',
  };
}

module.exports = { buildGhostingKnockoutPrompt };
