const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Parse a resume buffer into plain text.
 * @param {Buffer} buffer  — file contents
 * @param {string} mimetype — MIME type of the uploaded file
 * @returns {Promise<string>} extracted text
 */
async function parseResume(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    return parsePDF(buffer);
  }
  if (
    mimetype ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return parseDOCX(buffer);
  }
  // Legacy .doc format (application/msword) — extract via mammoth (best-effort)
  if (mimetype === 'application/msword') {
    return parseDOCX(buffer);
  }
  // Plain text (.txt)
  if (mimetype === 'text/plain') {
    return parseTXT(buffer);
  }
  throw new Error(`Unsupported file type: ${mimetype}`);
}

async function parsePDF(buffer) {
  const data = await pdfParse(buffer);
  return data.text || '';
}

async function parseDOCX(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

/**
 * Parse a plain text file buffer.
 * @param {Buffer} buffer — file contents
 * @returns {string} extracted text
 */
function parseTXT(buffer) {
  return buffer.toString('utf-8').trim();
}

module.exports = { parseResume };

