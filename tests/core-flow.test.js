const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const JSZip = require('jszip');
const {
  detectATS,
  processJobDescription,
  sanitizeCompanyNameValue,
} = require('../lib/jd-processor');
const { extractKeywords, matchKeywords } = require('../lib/keywords');
const { getEmailDomain } = require('../lib/mailer');
const { closeBrowser } = require('../lib/playwright-browser');
const pdfParse = require('pdf-parse');
const { buildResumeData, generateDOCX, generatePDF } = require('../lib/resume-builder');
const { renderResumePdf, resolveResumeText, resolveScanJobContext } = require('../lib/render-service');
const { validatePDF } = require('../lib/resume-builder');
const { renderTemplate } = require('../lib/template-renderer');
const { getUploadsRoot, uploadUrlToPath } = require('../lib/uploads');
const { parseCoverLetter } = require('../lib/cover-letter-parser');
const { extractLinkedInAvatarUrl } = require('../lib/oauth-profiles');

async function extractDocxXml(buffer, filePath = 'word/document.xml') {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(filePath);
  assert.ok(file, `expected ${filePath} in generated docx`);
  return file.async('string');
}

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
Product-minded operations leader with 7+ years of experience shipping workflow automation, analytics, and hiring-platform integrations for fast-moving SaaS teams. Experienced in cross-functional delivery, candidate funnel optimization, and recruiter tooling for enterprise hiring environments.

EXPERIENCE
Senior Program Manager - Northstar Labs 01/2022 - Present
• Rebuilt hiring operations workflows across Workday, Greenhouse, and LinkedIn integrations, reducing manual recruiter triage time by 38%.
• Led cross-functional launch plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America.
• Created analytics dashboards that surfaced funnel drop-off, application quality, and portal completion failures, improving qualified applicant conversion by 24%.
• Partnered with design and support teams to simplify applicant workflows, lowering form-correction tickets by 31%.

Program Manager - Brightpath Software 06/2018 - 12/2021
• Standardized resume intake and export templates for enterprise clients, improving ATS parse stability for customer success teams.
• Partnered with product and design to simplify candidate workflows and reduce form correction issues after upload.
• Introduced recruiter-facing reporting that made parse failures, missing fields, and completion bottlenecks visible to operations leaders.

EDUCATION
B.Sc. Business Information Systems - University College Dublin 2018

TECHNICAL SKILLS
ATS Workflows, Workday, Lever, LinkedIn Jobs, SQL, Analytics, Process Design, Stakeholder Management

PROJECTS
Recruiter Workflow Console 2021
• Built a workflow console for recruiting operations reviews, helping customer success teams spot ATS completion failures faster.

CERTIFICATIONS
Certified Scrum Master

LANGUAGES
English, French`,
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

  it('extracts the role and company from pasted fallback job descriptions', async () => {
    const jd = `Full job description
Lock Doctor are Ireland's largest locksmiths, providing 24 hour call out services.

We require an experienced Operations Booking Agent to join our team in Limerick.

Responsibilities
Provide top class customer service

Essential Requirements
Excellent attention to detail`;

    const result = await processJobDescription(jd, '', '');

    assert.equal(result.jobTitle, 'Operations Booking Agent');
    assert.equal(result.companyName, 'Lock Doctor');
    assert.equal(sanitizeCompanyNameValue('ie.indeed.com'), '');
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

  it('does not derive hard skills from unrelated substrings in a customer-service JD', () => {
    const jdText = `Responsibilities
Provide top class customer service
Responsible for rapid service delivery
Deal with escalated customer requirements as an urgent priority

Essential Requirements
Excellent communication skills both written and oral
Excellent attention to detail`;

    const jdKeywords = extractKeywords(jdText);
    const hardTerms = jdKeywords.hardSkills.map(item => item.term);

    assert.equal(hardTerms.includes('scala'), false);
    assert.equal(hardTerms.includes('api'), false);
    assert.equal(hardTerms.includes('excel'), false);
  });

  it('keeps recruiter-view missing keywords focused on real JD requirements', () => {
    const resumeText = `Ghasmir Ahmad
ghasmir@example.com | Limerick, Ireland

EXPERIENCE
Customer Service Executive - Eir 01/2024 - Present
• Managed high-volume customer requests and escalations across phone and email channels.
• Coordinated service bookings, prioritised urgent requests, and maintained accurate records.

TECHNICAL SKILLS
Customer service, communication`;

    const jdText = `Full job description
Lock Doctor are Ireland's largest locksmiths.
We require an experienced Operations Booking Agent to join our team in Limerick.

Responsibilities
Provide top class customer service
Responsible for rapid service delivery
Deal with escalated customer requirements as an urgent priority

Essential Requirements
Excellent communication skills both written and oral
Excellent attention to detail`;

    const keywordResults = matchKeywords(extractKeywords(resumeText), extractKeywords(jdText));
    const missingTerms = keywordResults.missing.map(item => item.term);

    assert.equal(missingTerms.includes('scala'), false);
    assert.equal(missingTerms.includes('api'), false);
    assert.equal(missingTerms.includes('excel'), false);
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

  it('does not turn wrapped comma-heavy bullet lines into fake experience entries', () => {
    const resumeText = `Hafiz Talha Naseem
Software Engineer | Data Engineer
Fullstack developer with 3 years of experience
Dooradoyle Limerick, Ireland
089 983 4139
talharajpoott513@gmail.com

EXPERIENCE
TechGenies, Limerick, Ireland(remote) - Software Developer
08/2022 – Present
Development and maintenance of software applications and infrastructure
using MEAN/MERN stack
• Lead the development and maintenance of enterprise-grade
applications using the (javascript, typescript, SQL, NOSQL, python,
HTML, CSS, React), contributing to multiple high-impact client projects
including an ERP System, E-Commerce Platform, and Customer
Support Ticketing System.
• Managed Azure-based deployments and CI/CD pipelines, improving
deployment reliability and minimizing downtime.
Devsinc, Islamabad, Pakistan - Software Engineer
02/2022 – 08/2022
• Implemented SQL Server for efficient data management,
decreasing data access time by 35%.

TECHNICAL SKILLS
Python, Node.js, JavaScript`;

    const data = buildResumeData(resumeText, {}, [], []);

    assert.equal(data.sections.experience.length, 2);
    assert.equal(data.sections.experience[0].title, 'Software Developer');
    assert.equal(data.sections.experience[1].company, 'Devsinc');
    assert.match(
      data.sections.experience[0].bullets[1],
      /HTML, CSS, React\), contributing to multiple high-impact client projects including an ERP System/i
    );
  });

  it('keeps a concise source headline instead of replacing it with a generic fallback summary', () => {
    const resumeText = `Hafiz Talha Naseem
Software Engineer | Data Engineer
Fullstack developer with 3 years of experience
Dooradoyle Limerick, Ireland
089 983 4139
talharajpoott513@gmail.com

EXPERIENCE
TechGenies - Software Developer 08/2022 – Present
• Built enterprise applications for customer support workflows.

TECHNICAL SKILLS
JavaScript, TypeScript, SQL`;

    const data = buildResumeData(resumeText, {}, [], []);

    assert.match(data.sections.summary, /Fullstack developer with 3 years of experience/i);
    assert.doesNotMatch(data.sections.summary, /Known for clear execution/i);
  });

  it('does not inject JD-only keyword-plan skills into exported resume content', () => {
    const resumeText = `Taylor Quinn
taylor@example.com | +353 86 123 4567 | Dublin, Ireland

EXPERIENCE
Support Specialist - Brightpath 01/2024 - Present
• Supported customer escalations across phone and email channels.

TECHNICAL SKILLS
Customer Support, CRM`;

    const data = buildResumeData(
      resumeText,
      {},
      [],
      [
        {
          keyword: 'SQL',
          section: 'Skills',
          suggestion: "Add to Skills section as: 'SQL, Documentation'",
          honest: true,
        },
        {
          keyword: 'Kubernetes',
          section: 'Skills',
          suggestion: "Add to Skills section as: 'Kubernetes'",
          honest: false,
        },
      ]
    );

    assert.doesNotMatch(data.sections.skills[0], /SQL/i);
    assert.doesNotMatch(data.sections.skills[0], /Documentation/i);
    assert.doesNotMatch(data.sections.skills[0], /Kubernetes/i);
  });

  it('keeps the summary grounded in resume evidence instead of keyword-plan hints', () => {
    const resumeText = `Taylor Quinn
taylor@example.com | Dublin, Ireland

EXPERIENCE
Support Specialist - Brightpath 01/2024 - Present
• Supported customer escalations across phone and email channels.

TECHNICAL SKILLS
Customer Support, CRM`;

    const data = buildResumeData(
      resumeText,
      {},
      [],
      [
        {
          keyword: 'Scala programming',
          section: 'Summary',
          suggestion: 'Core strengths include Scala programming.',
          honest: true,
        },
      ]
    );

    assert.doesNotMatch(data.sections.summary, /Scala programming/i);
  });

  it('keeps docx-style section boundaries and structured entries intact', () => {
    const resumeText = `Ghasmir Ahmad
Software Engineer and Data Analyst
Limerick, Ireland | Full right to work in Ireland | ghasmirahmad@gmail.com | +353 89 985 2814
Master CV
Ireland Tech Roles
Engineering | Data | Technical Support

PROFILE
Early-career software engineer and data analytics graduate with hands-on experience building production SaaS features, investigating technical faults, and translating complex issues into clear actions. Built commercial and academic projects across REST APIs, SQL and NoSQL data flows, analytics dashboards, machine learning pipelines, and blockchain applications. Brings a practical mix of engineering depth, customer-facing communication, and structured root-cause analysis suited to software, systems, data, and technical support roles across Ireland.

EXPERIENCE
Associate Application Developer | Chakor 01/2023 – 09/2023
Lahore, Pakistan (Hybrid)
Built Haddle, a multi-tenant employee sentiment platform for a commercial Australian client, delivering dashboards, survey workflows, and production-facing features used across multiple teams.
Designed and integrated REST APIs, scheduled survey logic, bulk data upload flows, and SQL and NoSQL-backed reporting views across company, team, and individual dashboards.
Worked in Agile sprints with product, design, QA, and senior engineers to ship tested features end to end and improve day-to-day delivery quality.
Technical Support Advisor | Eir 08/2025 – 02/2026
Limerick, Ireland (Hybrid)
Handled 40+ technical cases per shift, diagnosing broadband and PSTN connectivity incidents with remote diagnostic tools, telemetry, and structured root-cause analysis.
Maintained 90%+ SLA compliance across all KPIs and achieved the lowest repeat contact rate in the team at 4% through accurate diagnosis, escalation quality, and clear customer communication.
Escalated complex faults to Tier 2 and network engineering teams with precise documentation, reproduction steps, and impact notes that kept cases moving to resolution.
Freelance Blockchain Developer | Fiverr 01/2022 – 01/2023
Remote
Delivered Solidity smart contracts for international clients across Ethereum, BSC, and Polygon, including decentralised exchange contracts, a domain-verification system, and custom token logic.

CORE SKILLS
Languages: JavaScript, Python, SQL, Solidity, HTML, CSS
Engineering: REST APIs, webhooks, data pipelines, debugging, root-cause analysis
Data: SQL and NoSQL databases, anomaly detection, analytics dashboards, ML model evaluation
Tools: Git, Docker, ServiceNow, CRM and ticketing systems, Agile delivery

SELECTED IMPACT
40+ technical cases handled per shift in a high-volume support environment
4% repeat contact rate at Eir, lowest in team while maintaining 90%+ SLA compliance

PROJECTS
Cryptocurrency Market Manipulation Detection
Built an MSc thesis pipeline over 100,000+ transaction records and improved detection accuracy by 22% against baseline models.
SmartFarm / DairySmart
Developed a smart dairy farming system using Flask, PostgreSQL, IoT sensors, and YOLOv5-based computer vision for monitoring and analytics.

EDUCATION
MSc, Data Analytics
Technological University of the Shannon | 2024
BSc, Computer Science
FAST-NUCES | 2022`;

    const data = buildResumeData(resumeText, {}, [], []);

    assert.equal(data.sections.contact.includes('Ireland Tech Roles'), false);
    assert.doesNotMatch(data.sections.summary, /Master CV/i);
    assert.equal(data.sections.experience.length, 3);
    assert.equal(data.sections.experience[0].location, 'Lahore, Pakistan (Hybrid)');
    assert.equal(data.sections.experience[0].bullets.length, 3);
    assert.equal(data.sections.skills.length, 4);
    assert.equal(data.sections.strengths.length, 2);
    assert.equal(data.sections.projects.length, 2);
    assert.equal(data.sections.projects[0].bullets.length, 1);
    assert.equal(data.sections.education[0].degree, 'MSc, Data Analytics');
    assert.equal(data.sections.education[0].school, 'Technological University of the Shannon');
    assert.equal(data.sections.education[0].dates, '2024');

    const html = renderTemplate('refined', data, { template: 'refined' });
    assert.match(html, /SELECTED IMPACT/i);
    assert.match(html, /technical cases handled per shift/i);
  });

  it('allows experienced resumes to use a two-page budget', () => {
    const resumeText = `Jordan Blake
jordan@example.com | Dublin, Ireland

EXPERIENCE
Senior Consultant - Apex 01/2020 - Present
• Led operations work.
Consultant - Apex 01/2016 - 12/2019
• Built analytics workflows.

EDUCATION
B.Sc. Business 2015`;

    const data = buildResumeData(resumeText, {}, [], []);
    assert.equal(data.maxPages, 2);
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
    const { buffer, renderMeta } = await renderResumePdf(fixture, {
      watermark: true,
      template: 'modern',
    });
    assert.ok(buffer.length > 5000, 'expected non-trivial PDF output');
    assert.equal(renderMeta.renderStatus, 'ready');

    const validation = await validatePDF(buffer, {
      expectedName: 'Alex Morgan',
      maxPages: 1,
      minTextLength: 90,
    });

    assert.equal(validation.valid, true);
    assert.equal(validation.pageCount, 1);
  });

  it('renders the refined template when explicitly requested', async () => {
    const fixture = createFixture();
    const buffer = await generatePDF(
      fixture.optimized_resume_text,
      JSON.parse(fixture.section_data),
      JSON.parse(fixture.optimized_bullets),
      JSON.parse(fixture.keyword_plan),
      { template: 'refined', density: 'standard' }
    );

    const extracted = await pdfParse(buffer);
    assert.match(extracted.text, /CORE SKILLS/i);
    assert.doesNotMatch(extracted.text, /TECHNICAL SKILLS/i);
  });

  it('renders template-aware DOCX themes for ATS-safe exports', async () => {
    const fixture = createFixture();
    const refinedBuffer = await generateDOCX(
      fixture.optimized_resume_text,
      JSON.parse(fixture.section_data),
      JSON.parse(fixture.optimized_bullets),
      JSON.parse(fixture.keyword_plan),
      { template: 'refined', density: 'standard' }
    );
    const classicBuffer = await generateDOCX(
      fixture.optimized_resume_text,
      JSON.parse(fixture.section_data),
      JSON.parse(fixture.optimized_bullets),
      JSON.parse(fixture.keyword_plan),
      { template: 'classic', density: 'compact' }
    );
    const executiveBuffer = await generateDOCX(
      fixture.optimized_resume_text,
      JSON.parse(fixture.section_data),
      JSON.parse(fixture.optimized_bullets),
      JSON.parse(fixture.keyword_plan),
      { template: 'executive', density: 'standard' }
    );
    const corporateBuffer = await generateDOCX(
      fixture.optimized_resume_text,
      JSON.parse(fixture.section_data),
      JSON.parse(fixture.optimized_bullets),
      JSON.parse(fixture.keyword_plan),
      { template: 'corporate', density: 'standard' }
    );

    const refinedXml = await extractDocxXml(refinedBuffer);
    const classicXml = await extractDocxXml(classicBuffer);
    const executiveXml = await extractDocxXml(executiveBuffer);
    const corporateXml = await extractDocxXml(corporateBuffer);

    assert.match(refinedXml, /Aptos/);
    assert.match(refinedXml, /w:jc w:val="center"/);
    assert.match(classicXml, /Georgia/);
    assert.doesNotMatch(classicXml, /w:jc w:val="center"/);
    assert.match(executiveXml, /Georgia/);
    assert.match(corporateXml, /Arial/);
  });

  it('keeps only one dashboard CTA in the profile momentum card', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const profileSection = indexHtml.slice(
      indexHtml.indexOf('<section id="view-profile"'),
      indexHtml.indexOf('<!-- Profile Header with Avatar -->')
    );

    assert.match(profileSection, /id="profile-primary-action"/);
    assert.doesNotMatch(profileSection, />\s*View Dashboard\s*</);
  });

  it('maps upload urls into the runtime uploads directory safely', () => {
    const uploadsRoot = path.resolve(getUploadsRoot());
    const avatarPath = uploadUrlToPath('/uploads/avatars/example.png');

    assert.ok(avatarPath);
    assert.equal(
      avatarPath,
      path.join(uploadsRoot, 'avatars', 'example.png')
    );
    assert.equal(uploadUrlToPath('/public/avatars/example.png'), null);
  });

  it('extracts recipient domains for email delivery logging', () => {
    assert.equal(getEmailDomain('candidate@yahoo.com'), 'yahoo.com');
    assert.equal(getEmailDomain(''), 'unknown');
  });

  it('strips placeholder job context from cover letter rendering data', () => {
    const parsed = parseCoverLetter('Re: Full job description\n\nDear Hiring Team,\n\nThis is a sample.\n\nSincerely,\nTaylor', {
      name: 'Taylor',
      companyName: 'ATS-Optimized',
      jobTitle: 'Full job description',
    });

    assert.equal(parsed.companyName, '');
    assert.equal(parsed.recipientTitle, '');
    assert.deepEqual(parsed.paragraphs, ['This is a sample.']);
  });

  it('normalizes LinkedIn avatar payloads across common shapes', () => {
    assert.equal(
      extractLinkedInAvatarUrl({ picture: 'https://cdn.example.com/avatar.png' }),
      'https://cdn.example.com/avatar.png'
    );
    assert.equal(
      extractLinkedInAvatarUrl({
        picture: {
          data: { url: '//media.licdn.com/dms/image/example' },
        },
      }),
      'https://media.licdn.com/dms/image/example'
    );
    assert.equal(
      extractLinkedInAvatarUrl({
        picture: {
          elements: [{ identifiers: [{ identifier: 'https://cdn.example.com/nested.png' }] }],
        },
      }),
      'https://cdn.example.com/nested.png'
    );
  });
});
