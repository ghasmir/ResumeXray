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

module.exports = { parseResume };
