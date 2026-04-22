/**
 * Cover letter parser
 *
 * Turns the raw LLM cover letter text + scan context into the structured
 * shape that `lib/templates/cover-letter.html` expects.
 */

'use strict';

const {
  sanitizeCompanyNameValue,
  sanitizeJobTitleValue,
} = require('./jd-processor');

function formatToday() {
  const d = new Date();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function splitContact(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  return String(raw)
    .split(/\s*[|·•\n]\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

function stripClosing(body) {
  const phrases = ['Sincerely', 'Best regards', 'Kind regards', 'Yours truly', 'Respectfully', 'Warm regards', 'Regards'];
  const phrasesPattern = phrases.join('|');
  
  // Try newline-separated closing first
  const nlRe = new RegExp('\n+\\s*(' + phrasesPattern + ')[,.]?\\s*\n+?([\\s\\S]*)$', 'i');
  const m = body.match(nlRe);
  if (m) {
    const after = (m[2] || '').trim();
    const detectedName = after.split(/\n/).map(l => l.trim()).find(Boolean) || '';
    return { body: body.slice(0, m.index).trim(), detectedName };
  }
  
  // Fallback: inline closing at end — "...plans. Sincerely, Name"
  for (const phrase of phrases) {
    const idx = body.lastIndexOf(phrase);
    if (idx > 0 && idx > body.length - 150) {
      // Found a closing phrase near the end
      const before = body.slice(0, idx).trim();
      const after = body.slice(idx + phrase.length).replace(/^[,.\s]+/, '').trim();
      const detectedName = after.split(/\n/)[0].trim();
      return { body: before, detectedName };
    }
  }
  
  return { body: body.trim(), detectedName: '' };
}

function stripGreeting(body) {
  return body.replace(/^\s*Dear[^,\n]*,\s*\n*/i, '').trim();
}

function stripSubjectLine(body) {
  return body.replace(/^\s*Re:[^\n]*\n+/i, '').trim();
}

function guessHeaderFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { name: '', contact: [] };

  const isNameLike = (l) =>
    l.length > 0 && l.length <= 60 &&
    !/[\d@:]/.test(l) &&
    /^[A-Z][A-Za-z'. -]+$/.test(l);

  let name = '';
  let contact = [];
  if (isNameLike(lines[0])) {
    name = lines[0];
    for (let i = 1; i < Math.min(lines.length, 4); i++) {
      const l = lines[i];
      if (/@|(\+?\d[\d\s()-]{6,})|linkedin|github|https?:/i.test(l)) {
        contact = splitContact(l);
        break;
      }
    }
  }
  return { name, contact };
}

function parseCoverLetter(rawText, ctx = {}) {
  const text = String(rawText || '').replace(/\r\n?/g, '\n').trim();

  let name = (ctx.name || '').trim();
  let contact = splitContact(ctx.contact);
  if (!name || contact.length === 0) {
    const guessed = guessHeaderFromText(text);
    if (!name) name = guessed.name;
    if (contact.length === 0) contact = guessed.contact;
  }

  let body = text;
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerRe = new RegExp('^' + escaped + '[\\s\\S]*?\\n\\n', 'i');
    body = body.replace(headerRe, '').trim();
  }

  body = body.replace(/^\s*(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},\s*\d{4})\s*\n+/i, '').trim();
  body = stripSubjectLine(body);

  const { body: bodyNoClosing, detectedName } = stripClosing(body);
  body = bodyNoClosing;
  if (!name && detectedName) name = detectedName;

  body = stripGreeting(body);
  body = body.replace(/\s+(\d+\)\s+\*\*)/g, '\n\n$1');
  body = body.replace(/\s+(\d+\)\s+[A-Z])/g, '\n\n$1');
  
  const paragraphs = body
    .split(/\n{2,}/)
    .map(p => {
      return p
        .replace(/\s+\n\s*/g, ' ')
        .replace(/^\d+\)\s*/g, '')
        .replace(/\*\*/g, '')
        .trim();
    })
    .filter(Boolean);

  const companyName = sanitizeCompanyNameValue(ctx.companyName || '');
  const jobTitle = sanitizeJobTitleValue(ctx.jobTitle || '');
  const recipientName = companyName ? 'Hiring Team' : '';
  const recipientTitle = '';

  return {
    name: name || '',
    contact,
    date: formatToday(),
    recipientName,
    recipientTitle,
    companyName,
    paragraphs,
  };
}

module.exports = { parseCoverLetter };
