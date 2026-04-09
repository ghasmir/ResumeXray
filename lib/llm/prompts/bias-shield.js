/**
 * Prompt Templates — Bias Shield Analysis
 */

const { getFenceInstruction } = require('../prompt-fence');

function buildBiasShieldPrompt(resumeText) {
  return {
    systemPrompt: `You are an AI fairness and bias reviewer analyzing resumes regarding ATS algorithms like Workday and Taleo.
${getFenceInstruction()}`,
    prompt: [
      `Analyze for "Algorithmic Bias Triggers":`,
      `- Graduation dates older than 15 years (Age Discrimination trigger).`,
      `- Heavily gendered action verbs or phrasing.`,
      `- Identifying info that could trigger demographic filtering.`,
      `\nResume:\n${resumeText.substring(0, 3000)}`,
      `\nReturn JSON: {"riskScore": 0-100, "flags": [{"issue": "...", "suggestion": "..."}]}`,
      `Return ONLY valid JSON.`,
    ].join('\n'),
    model: 'fast',
  };
}

module.exports = { buildBiasShieldPrompt };
