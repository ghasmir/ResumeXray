#!/usr/bin/env node
require('dotenv').config();

process.env.DB_ENGINE = process.env.DB_ENGINE || 'pg';

const bcrypt = require('bcrypt');
const db = require('./database');

const baseResumeText = `Alex Morgan
alex.morgan@example.com | +353 87 555 0142 | linkedin.com/in/alexmorgan | Dublin, Ireland

PROFESSIONAL SUMMARY
Product-minded operations leader with 7+ years of experience shipping workflow automation, analytics, and hiring-platform integrations for fast-moving SaaS teams.

EXPERIENCE
Senior Program Manager - Northstar Labs 01/2022 - Present
• Rebuilt hiring operations workflows across Workday, Greenhouse, and LinkedIn integrations, reducing manual recruiter triage time by 38%.
• Led cross-functional launch plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America.
• Created analytics dashboards that surfaced funnel drop-off, application quality, and portal completion failures, improving qualified applicant conversion by 24%.

Program Manager - Brightpath Software 06/2018 - 12/2021
• Standardized resume intake and export templates for enterprise clients, improving ATS parse stability for customer success teams.
• Partnered with product and design to simplify candidate workflows and reduce form correction issues after upload.

EDUCATION
B.Sc. Business Information Systems - University College Dublin 2018

TECHNICAL SKILLS
ATS Workflows, Workday, Lever, LinkedIn Jobs, SQL, Analytics, Process Design, Stakeholder Management`;

function buildSeedAnalysis({ companyName, jobTitle, atsPlatform, atsDisplayName, missingKeywords }) {
  const summary = `Product-minded leader with experience optimizing resume workflows for ${companyName}.`;
  const xrayData = {
    engines: {
      enhancedParser: {
        Contact: {
          name: 'Alex Morgan',
          email: 'alex.morgan@example.com',
          phone: '+353 87 555 0142',
          linkedin: 'linkedin.com/in/alexmorgan',
          location: 'Dublin, Ireland',
        },
        Summary: summary,
        Experience:
          'Senior Program Manager - Northstar Labs 01/2022 - Present\n• Rebuilt hiring operations workflows across Workday, Greenhouse, and LinkedIn integrations, reducing manual recruiter triage time by 38%.\n• Led cross-functional launch plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America.',
        Education: 'B.Sc. Business Information Systems - University College Dublin 2018',
        Skills:
          'ATS Workflows, Workday, Lever, LinkedIn Jobs, SQL, Analytics, Process Design, Stakeholder Management',
      },
    },
    extractedFields: {
      Name: 'Alex Morgan',
      Email: 'alex.morgan@example.com',
      Phone: '+353 87 555 0142',
      Location: 'Dublin, Ireland',
      LinkedIn: 'linkedin.com/in/alexmorgan',
    },
    fieldAccuracy: {
      Name: { status: 'success', value: 'Alex Morgan' },
      Email: { status: 'success', value: 'alex.morgan@example.com' },
      Phone: { status: 'success', value: '+353 87 555 0142' },
      Location: { status: 'success', value: 'Dublin, Ireland' },
      LinkedIn: { status: 'success', value: 'linkedin.com/in/alexmorgan' },
      Summary: { status: 'success', value: summary },
      Experience: { status: 'success', value: 'Experience parsed successfully.' },
      Education: { status: 'success', value: 'Education parsed successfully.' },
      Skills: { status: 'success', value: 'Skills parsed successfully.' },
    },
    parseRate: 91,
  };

  return {
    parseRate: 91,
    formatHealth: 88,
    matchRate: 84,
    xrayData,
    formatIssues: [],
    keywordData: {
      matched: ['ATS', 'automation', 'analytics', 'workflow'].map(term => ({ term })),
      missing: missingKeywords.map(term => ({ term })),
    },
    sectionData: {
      name: 'Alex Morgan',
      contact:
        'alex.morgan@example.com | +353 87 555 0142 | linkedin.com/in/alexmorgan | Dublin, Ireland',
      sections: {
        summary: { found: true, label: 'Professional Summary' },
        experience: { found: true, label: 'Work Experience' },
        education: { found: true, label: 'Education' },
        skills: { found: true, label: 'Skills' },
      },
    },
    recommendations: [
      `Lead with the ${atsDisplayName} compatibility signal before export.`,
      `Tie resume bullets more directly to ${jobTitle.toLowerCase()} outcomes.`,
    ],
    aiSuggestions: {
      biasShield: { riskScore: 6, flags: [] },
      aiShieldData: { ghostingBullets: [], knockoutRisks: [] },
    },
    optimizedBullets: [
      {
        original:
          'Led cross-functional launch plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America.',
        rewritten:
          'Directed rollout plans for applicant-tracking automation used by 120+ recruiters across EMEA and North America, cutting manual coordination time by 32%.',
        method: 'AI-optimized rewrite',
        targetKeyword: 'workflow automation',
      },
    ],
    keywordPlan: [
      {
        keyword: 'portal completion',
        section: 'Experience',
        suggestion: 'Mention how you reduced candidate drop-off or manual field correction after upload.',
      },
    ],
    optimizedResumeText: baseResumeText,
    coverLetterText: `Dear Hiring Team,

I build cleaner hiring workflows. At Northstar Labs I rebuilt ATS-facing workflows across Workday, Greenhouse, and LinkedIn integrations, reducing recruiter triage time by 38% while supporting 120+ recruiters across EMEA and North America.

I care about reliable candidate conversion. Your ${jobTitle} role stands out because it sits at the intersection of workflow design, analytics, and candidate experience. I have led product and operations work that improved application quality, surfaced funnel drop-off, and made ATS data more dependable for hiring teams.

Sincerely,`,
    atsPlatform,
  };
}

async function createSeedUser({ email, name, password, tier, extraCredits }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const id = await db.createUser({
    email,
    name,
    passwordHash,
    verificationToken: null,
  });
  await db.verifyUser(id);
  if (tier && tier !== 'free') {
    await db.updateUserTier(id, tier);
  }
  if (extraCredits > 0) {
    await db.addCredits(id, extraCredits, 'purchase', null, 'Seeded opening balance');
  }
  return id;
}

async function seed() {
  console.log('🌱 Seeding PostgreSQL database...');

  const demoUserId = await createSeedUser({
    email: 'demo@resumexray.com',
    name: 'Demo User',
    password: 'demo1234',
    tier: 'free',
    extraCredits: 2,
  });

  const proUserId = await createSeedUser({
    email: 'pro@resumexray.com',
    name: 'Pro User',
    password: 'pro12345',
    tier: 'pro',
    extraCredits: 24,
  });

  await createSeedUser({
    email: 'hustler@resumexray.com',
    name: 'Hustler User',
    password: 'pro12345',
    tier: 'hustler',
    extraCredits: 99,
  });

  console.log('  ✓ Demo accounts created');

  const proResumeId = await db.saveResume(proUserId, {
    name: 'Alex Morgan Base Resume',
    fileName: 'alex-morgan-resume.pdf',
    fileType: 'pdf',
    fileSize: Buffer.byteLength(baseResumeText, 'utf8'),
    rawText: baseResumeText,
    parsedData: {
      name: 'Alex Morgan',
      contact: 'alex.morgan@example.com | +353 87 555 0142 | linkedin.com/in/alexmorgan | Dublin, Ireland',
    },
  });

  const seedScans = [
    {
      jobUrl:
        'https://northstar.wd5.myworkdayjobs.com/en-US/Careers/job/Senior-Program-Manager_R-48211',
      jobTitle: 'Senior Program Manager',
      companyName: 'Northstar',
      atsPlatform: 'workday',
      atsDisplayName: 'Workday',
      jobDescription:
        'Job Title: Senior Program Manager\nCompany: Northstar\nDrive hiring workflow automation, recruiter operations analytics, and ATS optimization for a high-growth SaaS team.',
      templateProfile: {
        template: 'minimal',
        defaultDensity: 'compact',
        singleColumn: true,
        noTables: true,
        strictHeaders: true,
        strictDates: true,
      },
      missingKeywords: ['portal completion', 'stakeholder alignment'],
    },
    {
      jobUrl:
        'https://recruitment.cezannehr.com/RecruitmentPortal/OpportunityDetails?opportunityId=apple-retail-technical-specialist',
      jobTitle: 'Retail Technical Specialist',
      companyName: 'Apple',
      atsPlatform: 'cezannehr',
      atsDisplayName: 'Cezanne HR',
      jobDescription:
        'Job Title: Retail Technical Specialist\nCompany: Apple\nSupport customers in-store, resolve device issues, and deliver premium technical service in a high-volume retail environment.',
      templateProfile: {
        template: 'minimal',
        defaultDensity: 'compact',
        singleColumn: true,
        noTables: true,
        strictHeaders: true,
        strictDates: true,
      },
      missingKeywords: ['device troubleshooting', 'customer education'],
    },
  ];

  const createdScanIds = [];

  for (const seedScan of seedScans) {
    const analysis = buildSeedAnalysis(seedScan);
    const jobContext = {
      jobUrl: seedScan.jobUrl,
      jobTitle: seedScan.jobTitle,
      companyName: seedScan.companyName,
      jdText: seedScan.jobDescription,
      jdSource: 'scraped_url',
      scrapeStatus: 'ready',
      scrapeError: '',
      atsPlatform: seedScan.atsPlatform,
      atsDisplayName: seedScan.atsDisplayName,
      templateProfile: seedScan.templateProfile,
    };

    const { scanId } = await db.saveScan(proUserId, {
      resumeId: proResumeId,
      jobDescription: seedScan.jobDescription,
      jobUrl: seedScan.jobUrl,
      jobTitle: seedScan.jobTitle,
      companyName: seedScan.companyName,
      atsPlatform: seedScan.atsPlatform,
      jobContext,
      parseRate: analysis.parseRate,
      formatHealth: analysis.formatHealth,
      matchRate: analysis.matchRate,
      xrayData: analysis.xrayData,
      formatIssues: analysis.formatIssues,
      keywordData: analysis.keywordData,
      sectionData: analysis.sectionData,
      recommendations: analysis.recommendations,
      aiSuggestions: analysis.aiSuggestions,
      renderMeta: {
        renderStatus: 'pending',
        renderAttempts: [],
        renderTemplate: seedScan.templateProfile.template,
        renderDensity: seedScan.templateProfile.defaultDensity,
        renderError: '',
        previewReady: false,
        resumeTextSource: '',
      },
    });

    await db.updateScanWithOptimizations(scanId, {
      optimizedBullets: analysis.optimizedBullets,
      keywordPlan: analysis.keywordPlan,
      optimizedResumeText: analysis.optimizedResumeText,
      coverLetterText: analysis.coverLetterText,
      atsPlatform: seedScan.atsPlatform,
      jobContext,
      renderMeta: {
        renderStatus: 'pending',
        renderAttempts: [],
        renderTemplate: seedScan.templateProfile.template,
        renderDensity: seedScan.templateProfile.defaultDensity,
        renderError: '',
        previewReady: false,
        resumeTextSource: '',
      },
    });

    await db.saveJob(proUserId, {
      scanId,
      company: seedScan.companyName,
      title: seedScan.jobTitle,
      url: seedScan.jobUrl,
      status: 'saved',
      location: 'Ireland',
      remote: 'hybrid',
    });

    createdScanIds.push(scanId);
  }

  await db.saveCoverLetter(proUserId, {
    scanId: createdScanIds[0] || null,
    title: 'Northstar Cover Letter',
    content: 'Generated seed cover letter for the Northstar workday target.',
  });

  console.log('  ✓ Representative resumes, scans, jobs, and cover letters created');
  console.log('    demo@resumexray.com / demo1234');
  console.log('    pro@resumexray.com / pro12345');
  console.log('    hustler@resumexray.com / pro12345');

  await db.recordGuestScan('seeded-guest');
  await db.recordGuestScan('seeded-guest');
  console.log('  ✓ Guest scan fixtures created');
}

seed()
  .catch(err => {
    console.error('PG seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.closeDb();
    } catch {
      /* ignore close failure */
    }
  });
