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
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return parseDOCX(buffer);
  }
  throw new Error(`Unsupported file type: ${mimetype}`);
}

// Resumes are functionally never longer than ~6 pages. A larger PDF is either
// a portfolio dump, a scanned document, or a malicious resource-exhaustion
// payload. We cap the layout-aware parse at PARSE_PAGE_LIMIT pages — beyond
// that we fall straight back to the cheap linear parser to avoid running the
// O(n^2) row/cluster passes per page.
const PARSE_PAGE_LIMIT = 8;

async function parsePDF(buffer) {
  try {
    const meta = await pdfParse(buffer, { max: 1 });
    const numpages = Number(meta.numpages) || 0;
    if (numpages > PARSE_PAGE_LIMIT) {
      // Cap the linear fallback at PARSE_PAGE_LIMIT pages so we still bound
      // CPU/memory regardless of how many pages the upstream PDF claims.
      const capped = await pdfParse(buffer, { max: PARSE_PAGE_LIMIT });
      return normalizePdfText(capped.text || '');
    }

    const data = await pdfParse(buffer, {
      pagerender: renderPdfPagePreservingLayout,
    });
    const text = normalizePdfText(data.text || '');
    if (text.length >= 80) {
      return text;
    }
  } catch {
    // Fall through to the legacy linear parser.
  }

  const data = await pdfParse(buffer, { max: PARSE_PAGE_LIMIT });
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
    if (!str) {
      continue;
    }

    if (previous) {
      const gap = item.x - (previous.x + previous.w);
      const gapUnit = Math.max(2, (averageCharWidth(previous) + averageCharWidth(item)) / 2);
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

function splitRowIntoSpans(items, gapThreshold = 28) {
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

  if (current.length > 0) {
    spans.push(current);
  }

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

function kmeans3(values) {
  if (values.length < 3) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  let centerA = sorted[0];
  let centerB = sorted[Math.floor(sorted.length / 2)];
  let centerC = sorted[sorted.length - 1];

  for (let i = 0; i < 30; i++) {
    const clusterA = [];
    const clusterB = [];
    const clusterC = [];

    for (const value of values) {
      const dA = Math.abs(value - centerA);
      const dB = Math.abs(value - centerB);
      const dC = Math.abs(value - centerC);
      if (dA <= dB && dA <= dC) {
        clusterA.push(value);
      } else if (dB <= dC) {
        clusterB.push(value);
      } else {
        clusterC.push(value);
      }
    }

    const mean = arr =>
      arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : null;

    const nextA = mean(clusterA) ?? centerA;
    const nextB = mean(clusterB) ?? centerB;
    const nextC = mean(clusterC) ?? centerC;

    const converged =
      Math.abs(nextA - centerA) < 0.5 &&
      Math.abs(nextB - centerB) < 0.5 &&
      Math.abs(nextC - centerC) < 0.5;

    centerA = nextA;
    centerB = nextB;
    centerC = nextC;

    if (converged) {
      break;
    }
  }

  return [centerA, centerB, centerC].sort((a, b) => a - b);
}

function detectColumnSplit(entries) {
  if (!Array.isArray(entries) || entries.length < 10) {
    return null;
  }

  const starts = entries.map(entry => entry.x);
  const [leftCenter, rightCenter] = kmeans2(starts);
  if (rightCenter - leftCenter < 120) {
    return null;
  }

  // Detect a possible third column when the binary split spans a wide range
  // (typical 3-column resumes spread sidebar/main/secondary across 300+ pt).
  // If a tight middle cluster exists, return [splitLeftMid, splitMidRight];
  // otherwise return the legacy single split point.
  if (rightCenter - leftCenter > 280) {
    const triple = kmeans3(starts);
    if (triple) {
      const [c1, c2, c3] = triple;
      // Require each gap to be large enough to be a real column boundary.
      if (c2 - c1 >= 100 && c3 - c2 >= 100) {
        return [(c1 + c2) / 2, (c2 + c3) / 2];
      }
    }
  }

  return (leftCenter + rightCenter) / 2;
}

function bandOf(x, splitPoints) {
  // splitPoints is sorted ascending. Returns the column band index (0-based).
  for (let i = 0; i < splitPoints.length; i++) {
    if (x < splitPoints[i]) {
      return i;
    }
  }
  return splitPoints.length;
}

function serializeEntries(entries, split) {
  if (!split) {
    return normalizePdfText(
      [...entries]
        .sort((a, b) => b.y - a.y)
        .map(entry => entry.text)
        .join('\n')
    );
  }

  // Normalize split into an array of split points. Single-split layouts pass
  // a number (legacy two-column behavior); 3-column layouts pass an array.
  const splitPoints = Array.isArray(split) ? [...split].sort((a, b) => a - b) : [split];
  const bandCount = splitPoints.length + 1;

  const firstSectionIndex = entries.findIndex(entry => PDF_SECTION_HEADER_RE.test(entry.text));

  const headerEntries = firstSectionIndex > 0 ? entries.slice(0, firstSectionIndex) : [];
  const bodyEntries = firstSectionIndex > 0 ? entries.slice(firstSectionIndex) : entries;

  const collectBand = (source, bandIndex) =>
    source
      .filter(entry => bandOf(entry.x, splitPoints) === bandIndex)
      .sort((a, b) => b.y - a.y)
      .map(entry => entry.text);

  const parts = [];
  for (let band = 0; band < bandCount; band++) {
    parts.push(...collectBand(headerEntries, band));
  }
  // Separator between header block and body content.
  if (bodyEntries.length) {
    parts.push('');
  }
  for (let band = 0; band < bandCount; band++) {
    const slice = collectBand(bodyEntries, band);
    if (slice.length === 0) {
      continue;
    }
    if (parts.length > 0 && parts[parts.length - 1] !== '') {
      parts.push('');
    }
    parts.push(...slice);
  }

  return normalizePdfText(parts.join('\n'));
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
