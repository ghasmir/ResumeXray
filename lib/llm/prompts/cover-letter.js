/**
 * Prompt Templates — Cover Letter Generation
 * 
 * Format: Exactly matches the user's reference design.
 * - Opening: 1–2 concise sentences
 * - 2 numbered bold-lead paragraphs (3–4 sentences each)
 * - Short closing: 2 sentences
 * - Total: 180–240 words MAXIMUM (must fit on one A4 page)
 */

const { getFenceInstruction } = require('../prompt-fence');

const BANNED_TERMS_SHORT = 'delve, tapestry, spearheaded, orchestrated, synergy, navigated, landscape, testament, beacon, fostered, leveraged, utilized, facilitated, pioneered, transformative, groundbreaking, game-changing, paradigm, ecosystem, robust, seamlessly, empower';

function buildCoverLetterPrompt(resumeText, jobDescription, jobContext = null) {
  const contextLines = [];
  if (jobContext?.jobTitle) contextLines.push(`Role: ${jobContext.jobTitle}`);
  if (jobContext?.companyName) contextLines.push(`Company: ${jobContext.companyName}`);
  if (jobContext?.atsDisplayName) contextLines.push(`ATS Platform: ${jobContext.atsDisplayName}`);
  if (jobContext?.jdSource) contextLines.push(`Job Source: ${jobContext.jdSource}`);

  return {
    systemPrompt: `You are writing a concise, credible cover letter for a real job application. STRICT RULES:

FORMAT (follow EXACTLY — do NOT deviate):
- Line 1: "Dear Hiring Team,"  
- Line 2: 1–2 sentence opening that names the role or company when known and states one concrete reason this candidate fits.
- Blank line
- "1)  **Bold 6-8 word thesis about your #1 technical strength.** Then 3–4 sentences of specific evidence. Include metrics (40%, 50%, 113,000 rows, etc.), tools, and project names from the resume."
- Blank line  
- "2)  **Bold 6-8 word thesis about company or role fit.** Then 3–4 sentences connecting resume evidence to the team's actual needs. If the company mission is unclear, focus on role fit and execution style instead of inventing mission language."
- Blank line
- 2 sentence closing paragraph expressing enthusiasm.
- Blank line
- "Sincerely,"

CRITICAL CONSTRAINTS:
- MAXIMUM 240 words total. This MUST fit on one page.
- Every paragraph must contain specific metrics, tools, shipped work, or domain evidence from the resume or JD.
- Only use facts supported by the resume or job description.
- Never use: ${BANNED_TERMS_SHORT}
- Never use generic hooks such as "I'll be direct", "two things made me stop and apply", "I am excited to apply", "I believe I am a great fit", or "perfect fit".
- Never flatter the company or repeat the JD back word-for-word.
- Use **double asterisks** for bold thesis at start of points 1) and 2).
- Tone: Professional, calm, peer-to-peer. Not desperate. Not salesy.
${getFenceInstruction()}`,
    prompt: [
      `Write the cover letter based on:`,
      contextLines.length ? `\nRESOLVED JOB CONTEXT:\n${contextLines.join('\n')}` : '',
      `\nRESUME:\n${resumeText.substring(0, 3500)}`,
      `\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}`,
      `\nOutput ONLY the letter starting with "Dear Hiring Team,". No headers, no [placeholders]. End with "Sincerely," on its own line. Keep it under 250 words.`,
    ].join('\n'),
    model: 'premium',
  };
}

module.exports = { buildCoverLetterPrompt };
