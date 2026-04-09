/**
 * Prompt Templates — Interview Prep
 */

const { getFenceInstruction } = require('../prompt-fence');

function buildInterviewPrepPrompt(resumeText, jobDescription) {
  return {
    systemPrompt: `You are an expert technical recruiter and hiring manager. You generate highly likely interview questions based on gaps between a candidate's resume and the job requirements.
${getFenceInstruction()}`,
    prompt: [
      `Generate 5 likely interview questions based on:`,
      `\nResume:\n${resumeText.substring(0, 3000)}`,
      `\nJob Description:\n${jobDescription.substring(0, 3000)}`,
      `\nFocus on gaps where their resume lacks detail or core strengths the employer will probe.`,
      `For each, provide a brief tip on how to answer effectively.`,
      `\nReturn a JSON array: [{"question": "...", "tip": "..."}]`,
      `Return ONLY valid JSON.`,
    ].join('\n'),
    model: 'fast',
  };
}

module.exports = { buildInterviewPrepPrompt };
