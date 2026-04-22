/**
 * Prompt Templates — Cover Letter Generation
 *
 * Output contract:
 * - Start with "Dear Hiring Team,"
 * - 3 to 4 clean paragraphs
 * - No numbered points
 * - No markdown bullets
 * - No subject line
 * - End with "Sincerely," on its own line
 */

const { getFenceInstruction } = require('../prompt-fence');
const {
  sanitizeCompanyNameValue,
  sanitizeJobTitleValue,
} = require('../../jd-processor');

const BANNED_TERMS_SHORT =
  'delve, tapestry, spearheaded, orchestrated, synergy, navigated, landscape, testament, beacon, fostered, leveraged, utilized, facilitated, pioneered, transformative, groundbreaking, game-changing, paradigm, ecosystem, robust, seamlessly, empower';

function buildCoverLetterPrompt(resumeText, jobDescription, jobContext = null) {
  const safeRole = sanitizeJobTitleValue(jobContext?.jobTitle || '');
  const safeCompany = sanitizeCompanyNameValue(jobContext?.companyName || '');
  const contextLines = [];

  if (safeRole) contextLines.push(`Role: ${safeRole}`);
  if (safeCompany) contextLines.push(`Company: ${safeCompany}`);
  if (jobContext?.jdSource) contextLines.push(`Job Source: ${jobContext.jdSource}`);

  return {
    systemPrompt: `You are writing a concise, role-aware cover letter for a real job application. STRICT RULES:

FORMAT:
- Start with: "Dear Hiring Team,"
- Write 3 or 4 short paragraphs in plain business prose.
- Opening paragraph: state interest in the role and why this candidate is relevant.
- Middle paragraphs: use specific evidence from the resume that maps to the target role.
- Closing paragraph: brief, direct, professional.
- End with: "Sincerely," on its own line.

CRITICAL CONSTRAINTS:
- Maximum 230 words.
- Use only facts supported by the resume or job description.
- If role or company is missing, do not invent it and do not use placeholders.
- No numbered lists, no bullet points, no markdown bold, no subject line, no "Re:" line.
- Never use: ${BANNED_TERMS_SHORT}
- Never use generic hooks such as "I am excited to apply", "perfect fit", "great fit", or company flattery.
- Tone: professional, direct, credible, and specific.
${getFenceInstruction()}`,
    prompt: [
      'Write the cover letter based on:',
      contextLines.length ? `\nRESOLVED JOB CONTEXT:\n${contextLines.join('\n')}` : '',
      `\nRESUME:\n${resumeText.substring(0, 3500)}`,
      `\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}`,
      '\nOutput ONLY the final letter. Start with "Dear Hiring Team," and end with "Sincerely,". Use plain paragraphs only.',
    ].join('\n'),
    model: 'premium',
  };
}

module.exports = { buildCoverLetterPrompt };
