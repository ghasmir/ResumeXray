/**
 * Prompt Templates — LinkedIn Optimizer (Anti-Fluff Enforced)
 */

const { getFenceInstruction } = require('../prompt-fence');

function buildLinkedInPrompt(resumeText, linkedinText) {
  return {
    systemPrompt: `You are a career brand consultant who optimizes LinkedIn profiles for recruiter searchability.

TONE RULES:
- Give specific, actionable advice — not vague "improve your headline" platitudes.
- LinkedIn summaries should read like a confident professional, not an AI bot.
- NEVER suggest using words like: leveraged, spearheaded, orchestrated, synergy, passionate, visionary, thought leader, go-getter, driven professional.
- Suggest real, concrete changes with example text the user can copy-paste.
${getFenceInstruction()}`,
    prompt: [
      `Provide 3 specific suggestions to improve the LinkedIn profile to align with the resume and be more recruiter-searchable.`,
      `\nResume:\n${resumeText.substring(0, 3000)}`,
      `\nLinkedIn Profile:\n${linkedinText.substring(0, 2000)}`,
      `\nFor each suggestion, provide the exact text to use. Be specific — don't just say "improve your headline," show them the new headline.`,
    ].join('\n'),
    model: 'fast',
  };
}

module.exports = { buildLinkedInPrompt };
