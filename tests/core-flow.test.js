const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

const { detectATS, processJobDescription } = require('../lib/jd-processor');
const { extractKeywords } = require('../lib/keywords');
const { closeBrowser } = require('../lib/playwright-browser');
const { buildResumeData } = require('../lib/resume-builder');
const { renderResumePdf, resolveResumeText, resolveScanJobContext } = require('../lib/render-service');
const { validatePDF } = require('../lib/resume-builder');

function createFixture(overrides = {}) {
  return {
    id: 999,
    job_context: JSON.stringify({
      jobUrl:
        'https://northstar.wd5.myworkdayjobs.com/en-US/Careers/job/Senior-Program-Manager_R-48211',
      jobTitle: 'Senior Program Manager',
      companyName: 'Northstar',
      jdText:
        'Job Title: Senior Program Manager\nCompany: Northstar\nDrive hiring workflow automation, recruiter operations analytics, and ATS optimization for a high-growth SaaS team.',
      jdSource: 'scraped_url',
      scrapeStatus: 'ready',
      scrapeError: '',
      atsPlatform: 'workday',
      atsDisplayName: 'Workday',
      templateProfile: {
        template: 'minimal',
        defaultDensity: 'compact',
        singleColumn: true,
        noTables: true,
        strictHeaders: true,
        strictDates: true,
      },
    }),
    section_data: JSON.stringify({
      name: 'Alex Morgan',
      contact:
        'alex.morgan@example.com | +353 87 555 0142 | linkedin.com/in/alexmorgan | Dublin, Ireland',
    }),
    xray_data: JSON.stringify({
      engines: {
        enhancedParser: {
          Contact: {
            name: 'Alex Morgan',
            email: 'alex.morgan@example.com',
            phone: '+353 87 555 0142',
            linkedin: 'linkedin.com/in/alexmorgan',
            location: 'Dublin, Ireland',
          },
          Summary:
            'Product-minded operations leader with 7+ years of experience shipping workflow automation, analytics, and hiring-platform integrations for fast-moving SaaS teams.',
          Experience:
            'Senior Program Manager - Northstar Labs 01/2022 - Present\n• Rebuilt hiring operations workflows across Workday, Greenhouse, and LinkedIn integrations, reducing manual recruiter triage time by 38%.\n• Led cross-functional launch plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America.',
          Education: 'B.Sc. Business Information Systems - University College Dublin 2018',
          Skills:
            'ATS Workflows, Workday, Lever, LinkedIn Jobs, SQL, Analytics, Process Design, Stakeholder Management',
        },
      },
      extractedFields: {
        Name: 'Alex Morgan',
      },
    }),
    optimized_resume_text: `Alex Morgan
alex.morgan@example.com | +353 87 555 0142 | linkedin.com/in/alexmorgan | Dublin, Ireland

PROFESSIONAL SUMMARY
Product-minded operations leader with 7+ years of experience shipping workflow automation, analytics, and hiring-platform integrations for fast-moving SaaS teams.

EXPERIENCE
Senior Program Manager - Northstar Labs 01/2022 - Present
• Rebuilt hiring operations workflows across Workday, Greenhouse, and LinkedIn integrations, reducing manual recruiter triage time by 38%.
• Led cross-functional launch plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America.
• Created analytics dashboards that surfaced funnel drop-off, application quality, and portal completion failures, improving qualified applicant conversion by 24%.

EDUCATION
B.Sc. Business Information Systems - University College Dublin 2018

TECHNICAL SKILLS
ATS Workflows, Workday, Lever, LinkedIn Jobs, SQL, Analytics, Process Design, Stakeholder Management`,
    optimized_bullets: JSON.stringify([
      {
        original:
          'Led cross-functional launch plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America.',
        rewritten:
          'Directed rollout plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America, cutting manual coordination time by 32%.',
        method: 'AI-optimized rewrite',
        targetKeyword: 'workflow automation',
      },
    ]),
    keyword_plan: JSON.stringify([
      {
        keyword: 'portal completion',
        section: 'Experience',
        suggestion: 'Mention how you reduced candidate drop-off or manual field correction after upload.',
      },
    ]),
    render_meta: JSON.stringify({ renderStatus: 'pending', renderAttempts: [] }),
    ...overrides,
  };
}

after(async () => {
  await closeBrowser();
});

describe('Core Flow Contracts', () => {
  it('detects top ATS portals from URLs', () => {
    assert.equal(
      detectATS(
        'https://northstar.wd5.myworkdayjobs.com/en-US/Careers/job/Senior-Program-Manager_R-48211'
      ).name,
      'workday'
    );
    assert.equal(
      detectATS('https://jobs.lever.co/brightpath/9d3412f8-platform-ops-manager').name,
      'lever'
    );
    assert.equal(
      detectATS(
        'https://www.linkedin.com/jobs/view/senior-data-analyst-at-northstar-labs-4383701980'
      ).name,
      'linkedin'
    );
    assert.equal(detectATS('https://www.indeed.com/viewjob?jk=123456').name, 'indeed');
    assert.equal(detectATS('https://recruitment.cezannehr.com/RecruitmentPortal/apply').name, 'cezannehr');
  });

  it('avoids sentence fragments when deriving job titles from pasted descriptions', async () => {
    const result = await processJobDescription(
      'Provide accurate, valid and complete information by using the right methods/tools.\n\nResponsibilities include customer support and store operations.',
      '',
      ''
    );

    assert.equal(result.jobTitle, '');
  });

  it('does not surface short ambiguous keywords like go and r without programming context', () => {
    const retailKeywords = extractKeywords(
      'Support customers in the Apple Store environment with clear communication, teamwork, troubleshooting, and point-of-sale operations.'
    );

    assert.equal(retailKeywords.hardSkills.some(item => item.term === 'go'), false);
    assert.equal(retailKeywords.hardSkills.some(item => item.term === 'r'), false);

    const engineeringKeywords = extractKeywords(
      'Build backend services in Golang and Go microservices, then analyze product data in R programming and RStudio.'
    );

    assert.equal(engineeringKeywords.hardSkills.some(item => item.term === 'golang'), true);
    assert.equal(engineeringKeywords.hardSkills.some(item => item.term === 'r'), true);
  });

  it('keeps wrapped bullet continuations inside the same experience entry', () => {
    const resumeText = `Taylor Quinn
taylor@example.com | +353 86 123 4567 | Dublin, Ireland

EXPERIENCE
Software Developer - TechGenies 01/2024 - Present
• Built scalable applications using the
javascript, typescript, SQL, NOSQL, python stack for ATS-heavy customer workflows
• Improved recruiter tooling used by 40 internal hiring managers

EDUCATION
B.Sc. Computer Science - UCD 2023

TECHNICAL SKILLS
JavaScript, TypeScript, SQL, Python`;

    const data = buildResumeData(resumeText, {}, [], []);
    assert.equal(data.sections.experience.length, 1);
    assert.equal(data.sections.experience[0].bullets.length, 2);
    assert.match(data.sections.experience[0].bullets[0], /javascript, typescript, SQL, NOSQL, python/i);
  });

  it('uses structured fallback text when optimized text is missing', () => {
    const { resumeText, source } = resolveResumeText(
      createFixture({ optimized_resume_text: '' })
    );
    assert.equal(source, 'structured_fallback');
    assert.match(resumeText, /Alex Morgan/);
    assert.match(resumeText, /EXPERIENCE/);
  });

  it('normalizes persisted job context', () => {
    const jobContext = resolveScanJobContext(createFixture());
    assert.equal(jobContext.companyName, 'Northstar');
    assert.equal(jobContext.atsDisplayName, 'Workday');
    assert.equal(jobContext.templateProfile.template, 'minimal');
  });

  it('renders a readable portal-targeted PDF preview', async () => {
    const fixture = createFixture();
    const { buffer, renderMeta } = await renderResumePdf(fixture, { watermark: true });
    assert.ok(buffer.length > 5000, 'expected non-trivial PDF output');
    assert.equal(renderMeta.renderStatus, 'ready');
    assert.equal(renderMeta.renderTemplate, 'minimal');

    const validation = await validatePDF(buffer, {
      expectedName: 'Alex Morgan',
      maxPages: 2,
      minTextLength: 90,
    });

    assert.equal(validation.valid, true);
    assert.ok(validation.pageCount >= 1);
  });
});
