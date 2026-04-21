const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const PDF_SECTION_HEADER_RE =
  /^(?:experience|work experience|professional experience|skills|technical skills|education|projects|summary|profile|objective|strengths|certifications|languages)\b/i;

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
  try {
    const data = await pdfParse(buffer, {
      pagerender: renderPdfPagePreservingLayout,
    });
    const text = normalizePdfText(data.text || '');
    if (text.length >= 80) return text;
  } catch {
    // Fall through to the legacy linear parser.
  }

  const data = await pdfParse(buffer);
  return data.text || '';
}

async function parseDOCX(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

function normalizePdfText(text) {
  return String(text || '')
    .replace(/\u200b/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function averageCharWidth(item) {
  const visibleLength = String(item.str || '').trim().length || 1;
  return Math.max(1, item.width / visibleLength);
}

function renderTextSpan(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let output = '';
  let previous = null;

  for (const item of sorted) {
    const str = String(item.str || '');
    if (!str) continue;

    if (previous) {
      const gap = item.x - (previous.x + previous.w);
      const gapUnit = Math.max(
        2,
        (averageCharWidth(previous) + averageCharWidth(item)) / 2
      );
      if (gap > gapUnit * 0.4 && !/^\s/.test(str) && !/\s$/.test(output)) {
        output += ' ';
      }
    }

    output += str;
    previous = item;
  }

  return normalizePdfText(output);
}

function groupTextItemsIntoRows(items, yTolerance = 1.2) {
  const rows = [];

  for (const item of items) {
    let row = rows.find(existing => Math.abs(existing.y - item.y) <= yTolerance);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }

    row.items.push(item);
    row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
  }

  return rows.sort((a, b) => b.y - a.y);
}

function splitRowIntoSpans(items, gapThreshold = 20) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const spans = [];
  let current = [];
  let previous = null;

  for (const item of sorted) {
    const str = String(item.str || '');
    const isWhitespaceOnly = !str.trim();
    const gap = previous ? item.x - (previous.x + previous.w) : 0;

    if (previous && !isWhitespaceOnly && gap > gapThreshold) {
      spans.push(current);
      current = [item];
    } else {
      current.push(item);
    }

    previous = item;
  }

  if (current.length > 0) spans.push(current);

  return spans
    .map(spanItems => ({
      x: Math.min(...spanItems.map(item => item.x)),
      text: renderTextSpan(spanItems),
    }))
    .filter(span => span.text);
}

function kmeans2(values) {
  let centerA = Math.min(...values);
  let centerB = Math.max(...values);

  for (let i = 0; i < 30; i++) {
    const clusterA = [];
    const clusterB = [];

    for (const value of values) {
      if (Math.abs(value - centerA) <= Math.abs(value - centerB)) {
        clusterA.push(value);
      } else {
        clusterB.push(value);
      }
    }

    const nextA = clusterA.length
      ? clusterA.reduce((sum, value) => sum + value, 0) / clusterA.length
      : centerA;
    const nextB = clusterB.length
      ? clusterB.reduce((sum, value) => sum + value, 0) / clusterB.length
      : centerB;

    if (Math.abs(nextA - centerA) < 0.5 && Math.abs(nextB - centerB) < 0.5) {
      break;
    }

    centerA = nextA;
    centerB = nextB;
  }

  return centerA < centerB ? [centerA, centerB] : [centerB, centerA];
}

function detectColumnSplit(entries) {
  if (!Array.isArray(entries) || entries.length < 10) return null;

  const starts = entries.map(entry => entry.x);
  const [leftCenter, rightCenter] = kmeans2(starts);
  if (rightCenter - leftCenter < 120) return null;

  return (leftCenter + rightCenter) / 2;
}

function serializeEntries(entries, splitX) {
  if (!splitX) {
    return normalizePdfText(
      [...entries]
        .sort((a, b) => b.y - a.y)
        .map(entry => entry.text)
        .join('\n')
    );
  }

  const firstSectionIndex = entries.findIndex(entry =>
    PDF_SECTION_HEADER_RE.test(entry.text)
  );

  const headerEntries =
    firstSectionIndex > 0 ? entries.slice(0, firstSectionIndex) : [];
  const bodyEntries =
    firstSectionIndex > 0 ? entries.slice(firstSectionIndex) : entries;

  const headerLeft = headerEntries
    .filter(entry => entry.x < splitX)
    .sort((a, b) => b.y - a.y)
    .map(entry => entry.text);
  const headerRight = headerEntries
    .filter(entry => entry.x >= splitX)
    .sort((a, b) => b.y - a.y)
    .map(entry => entry.text);
  const leftColumn = bodyEntries
    .filter(entry => entry.x < splitX)
    .sort((a, b) => b.y - a.y)
    .map(entry => entry.text);
  const rightColumn = bodyEntries
    .filter(entry => entry.x >= splitX)
    .sort((a, b) => b.y - a.y)
    .map(entry => entry.text);

  return normalizePdfText(
    [
      ...headerLeft,
      ...headerRight,
      '',
      ...leftColumn,
      rightColumn.length > 0 ? '' : null,
      ...rightColumn,
    ]
      .filter(part => part !== null)
      .join('\n')
  );
}

async function renderPdfPagePreservingLayout(pageData) {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });

  const items = textContent.items.map(item => ({
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
    w: item.width,
    h: item.height,
  }));

  const rows = groupTextItemsIntoRows(items);
  const entries = [];

  for (const row of rows) {
    const spans = splitRowIntoSpans(row.items);
    for (const span of spans) {
      entries.push({
        x: span.x,
        y: row.y,
        text: span.text,
      });
    }
  }

  const splitX = detectColumnSplit(entries);
  return serializeEntries(entries, splitX);
}

module.exports = { parseResume };
