/**
 * Worst-Case Pipeline Regression Tests — May 2026 stress-audit fixes.
 *
 * One test per fix-id from the audit, exercising the worst-case input that
 * previously corrupted the pipeline. Each test fails on the legacy code path
 * and passes on the hardened path.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeJobTitleValue, sanitizeCompanyNameValue } = require('../lib/jd-processor');
const { buildResumeData } = require('../lib/resume-builder');
const { structureExperience } = require('../lib/template-renderer');
const {
  validateBulletResult,
  detectFabricatedMetrics,
  extractNumericTokens,
} = require('../lib/llm/output-validator');

describe('Worst-Case Pipeline — May 2026 audit fixes', () => {
  // ── Fix #2 — isDecorativeHeaderLine $ anchor ─────────────────────────────
  it('strips decorative banners with trailing modifiers (Master CV - Tech Roles)', () => {
    const resumeText = `Ghasmir Ahmad
ghasmirahmad@gmail.com | +353 89 985 2814 | Limerick, Ireland
Master CV - Tech Roles
Master Resume — Engineering
Final CV (Draft)

PROFILE
Software engineer with 4 years of experience.

EXPERIENCE
Software Engineer - Acme 01/2022 - Present
• Built things.

EDUCATION
B.Sc. CS - UCD 2020`;

    const data = buildResumeData(resumeText, {}, [], []);
    const sectionDump = JSON.stringify(data.sections).toLowerCase();
    assert.ok(
      !sectionDump.includes('master cv - tech roles'),
      'decorative banner with suffix should be filtered'
    );
    assert.ok(!sectionDump.includes('master resume'), 'master resume banner should be filtered');
    assert.notEqual(data.sections.name, 'Master CV - Tech Roles');
  });

  // ── Fix #3 — sanitizeJobTitleValue sentence-fragment guard ────────────────
  it('rejects sentence-fragment job titles regardless of source path', () => {
    assert.equal(sanitizeJobTitleValue('Provide accurate info...'), '');
    assert.equal(sanitizeJobTitleValue('Please provide your details'), '');
    assert.equal(sanitizeJobTitleValue('We are looking for talent'), '');
    assert.equal(sanitizeJobTitleValue('Senior Engineer.'), '');
    assert.equal(sanitizeJobTitleValue('What is the role?'), '');
    // Long page-instruction copy
    assert.equal(
      sanitizeJobTitleValue(
        'Please provide accurate, valid and complete information by using the right methods and tools'
      ),
      ''
    );
    // Real titles still pass through
    assert.equal(sanitizeJobTitleValue('Senior Software Engineer'), 'Senior Software Engineer');
    assert.equal(sanitizeJobTitleValue('Operations Booking Agent'), 'Operations Booking Agent');
  });

  // ── Fix #7 — sanitizeCompanyNameValue aggregator brand guard ──────────────
  it('rejects plain aggregator brand names as employer', () => {
    assert.equal(sanitizeCompanyNameValue('Indeed'), '');
    assert.equal(sanitizeCompanyNameValue('LinkedIn'), '');
    assert.equal(sanitizeCompanyNameValue('Glassdoor'), '');
    assert.equal(sanitizeCompanyNameValue('Monster'), '');
    assert.equal(sanitizeCompanyNameValue('ZipRecruiter'), '');
    // Real company names still pass through
    assert.equal(sanitizeCompanyNameValue('Northstar Labs'), 'Northstar Labs');
    assert.equal(sanitizeCompanyNameValue('The Trade Desk'), 'The Trade Desk');
  });

  // ── Fix #6 — stripCoverLetter salutation-free embedded letters ─────────────
  it('strips embedded cover letters that lack a salutation', () => {
    const resumeWithEmbeddedLetter = `Alex Morgan
alex@example.com | +353 87 555 0142 | Dublin, Ireland

PROFESSIONAL SUMMARY
Operations leader with 7+ years of experience in workflow automation.

EXPERIENCE
Senior Manager - Northstar 01/2022 - Present
• Led automation rollout across teams.

I am writing to express my strong interest in the Senior Engineer role advertised on your careers page. My experience aligns directly with the requirements you have listed, and I would welcome the chance to discuss how I can contribute to your team.

Yours faithfully,
Alex`;
    const data = buildResumeData(resumeWithEmbeddedLetter, {}, [], []);
    const dump = JSON.stringify(data.sections).toLowerCase();
    assert.ok(
      !dump.includes('i am writing to express'),
      'salutation-free cover letter prose should be stripped'
    );
    assert.ok(!dump.includes('yours faithfully'), 'cover letter sign-off should be stripped');
    assert.match(data.sections.summary, /Operations leader/);
  });

  // ── Fix #5 — fabricated-metric detection in LLM bullet validator ──────────
  it('detects fabricated numeric metrics introduced by LLM rewrites', () => {
    // Original has no numbers; rewrite adds "47%"
    const fabricatedAdds = detectFabricatedMetrics(
      'Improved system reliability for the platform',
      'Improved platform reliability by 47%, reducing on-call incidents from 12 to 3 monthly'
    );
    assert.ok(
      fabricatedAdds.length >= 2,
      `expected fabricated metric tokens, got ${JSON.stringify(fabricatedAdds)}`
    );

    // Original has 38%; rewrite preserves it
    const honestPreserves = detectFabricatedMetrics(
      'Reduced onboarding time by 38%',
      'Cut onboarding time by 38% via Workday automation'
    );
    assert.deepEqual(honestPreserves, []);

    // Calendar years aren't flagged as metrics
    const yearTokens = extractNumericTokens('Worked at Northstar from 2018 to 2024');
    assert.ok(
      !yearTokens.includes('2018') && !yearTokens.includes('2024'),
      'calendar years should be excluded from metric token extraction'
    );

    // Validator integration: rewrite is reverted to original on fabrication
    const validated = validateBulletResult({
      original: 'Improved customer onboarding workflow',
      rewritten: 'Improved customer onboarding workflow by 47%, cutting time-to-first-value by 30%',
      method: 'CAR formula',
      needsMetric: false,
    });
    assert.equal(
      validated.rewritten,
      'Improved customer onboarding workflow',
      'fabricated rewrite should be reverted to the original'
    );
    assert.equal(validated.needsMetric, true);
    assert.ok(Array.isArray(validated.fabricatedMetrics));
    assert.match(validated.method, /reverted/i);
  });

  // ── Fix #10 — paragraph-to-bullet reconstruction ──────────────────────────
  it('reconstructs multiple bullets from a dense paragraph (DOCX paragraph-only resume)', () => {
    const resumeText = `Jordan Blake
jordan@example.com | +353 87 555 0140 | Dublin, Ireland

EXPERIENCE
Senior Engineer - Acme Corp 01/2022 - Present
Led a team of 8 engineers to deliver the Q4 roadmap, reducing churn by 12% through implementation of an automated retry system using Celery and Redis. Designed and shipped a new reporting dashboard, cutting time-to-report by 40% across customer success teams. Partnered with product to migrate the legacy ETL pipeline to Airflow + dbt, reducing pipeline runtime from 6 hours to 45 minutes.

EDUCATION
B.Sc. Computer Science - UCD 2018

TECHNICAL SKILLS
Python, Airflow, dbt, Redis, Celery`;

    const data = buildResumeData(resumeText, {}, [], []);
    assert.equal(data.sections.experience.length, 1);
    const bullets = data.sections.experience[0].bullets;
    assert.ok(
      bullets.length >= 2,
      `expected at least 2 reconstructed bullets, got ${bullets.length}`
    );
    // Original sentence content must be preserved across bullets
    const combined = bullets.join(' ');
    assert.match(combined, /Q4 roadmap/);
    assert.match(combined, /reporting dashboard/);
    assert.match(combined, /Airflow/);
  });

  // ── Fix #10 helper — direct structureExperience contract ──────────────────
  it('does not over-split short or single-sentence narrative lines', () => {
    const entries = structureExperience([
      'Senior Engineer - Acme 01/2022 - Present',
      'Built things and shipped them.',
    ]);
    assert.equal(entries.length, 1);
    // Short paragraph stays as one bullet
    assert.equal(entries[0].bullets.length, 1);
  });

  // ── Fix #1 — k-means 3-column safety: don't crash on flat layouts ─────────
  it('parser k-means helpers stay stable on degenerate single-column inputs', () => {
    // Indirect smoke: structureExperience is the public surface — verify a
    // typical single-column resume still parses cleanly with the wider
    // gapThreshold (no spurious column splits).
    const entries = structureExperience([
      'Senior Engineer - Acme 01/2022 - Present',
      '• Built scalable systems',
      '• Shipped features',
      'Junior Engineer - Beta 06/2018 - 12/2021',
      '• Maintained legacy services',
    ]);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].title, 'Senior Engineer');
    assert.equal(entries[1].company, 'Beta');
  });

  // ── Fix #9 — tab characters from mammoth DOCX table extraction ────────────
  it('normalizes mammoth tab-separated DOCX content into clean entries', () => {
    // Simulate mammoth-extracted DOCX where the role/date row was a 2-col table
    const resumeText =
      'Alex Morgan\nalex@example.com\n\nEXPERIENCE\nSenior Engineer\t01/2022 - Present\n• Built things\n\nEDUCATION\nB.Sc. CS - UCD 2018';
    const data = buildResumeData(resumeText, {}, [], []);
    // Tab should not survive into structured entry titles
    const titles = data.sections.experience.map(e => e.title).join('|');
    assert.ok(!titles.includes('\t'), 'tab characters must not survive into entry titles');
  });
});
