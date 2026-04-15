#!/usr/bin/env node
/**
 * Database Seed Script — Creates fresh DB with demo data
 * Run: node db/seed.js
 */
const path = require('path');
const bcrypt = require('bcrypt');

// Must require database AFTER ensuring old DB is removed
const { getDb, closeDb } = require('./database');

async function seed() {
  console.log('🌱 Seeding database...');
  const db = getDb();

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

  function buildSeedAnalysis({ companyName, jobTitle, atsPlatform, atsDisplayName }) {
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
        missing: ['stakeholder alignment', 'portal completion'].map(term => ({ term })),
      },
      sectionData: {
        name: 'Alex Morgan',
        contact: 'alex.morgan@example.com | +353 87 555 0142 | linkedin.com/in/alexmorgan | Dublin, Ireland',
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

1) **I build cleaner hiring workflows.** At Northstar Labs I rebuilt ATS-facing workflows across Workday, Greenhouse, and LinkedIn integrations, reducing recruiter triage time by 38% while supporting 120+ recruiters across EMEA and North America. That experience taught me how to improve candidate quality without creating more manual cleanup after upload.

2) **I care about reliable candidate conversion.** Your ${jobTitle} role stands out because it sits at the intersection of workflow design, analytics, and candidate experience. I have led product and operations work that improved application quality, surfaced funnel drop-off, and made ATS data more dependable for hiring teams.

Sincerely,`,
      atsPlatform,
    };
  }

  function insertSeedScan(userId, payload) {
    const existing = db
      .prepare('SELECT id FROM scans WHERE user_id = ? AND job_url = ? LIMIT 1')
      .get(userId, payload.jobUrl);
    if (existing) return false;

    db.prepare(`
      INSERT INTO scans (
        user_id, resume_id, access_token, job_description, job_url, job_title, company_name,
        ats_platform, job_context, parse_rate, format_health, match_rate, xray_data, format_issues,
        keyword_data, section_data, recommendations, ai_suggestions, optimized_bullets, keyword_plan,
        optimized_resume_text, cover_letter_text, render_meta
      ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      payload.jobDescription,
      payload.jobUrl,
      payload.jobTitle,
      payload.companyName,
      payload.atsPlatform,
      JSON.stringify(payload.jobContext),
      payload.analysis.parseRate,
      payload.analysis.formatHealth,
      payload.analysis.matchRate,
      JSON.stringify(payload.analysis.xrayData),
      JSON.stringify(payload.analysis.formatIssues),
      JSON.stringify(payload.analysis.keywordData),
      JSON.stringify(payload.analysis.sectionData),
      JSON.stringify(payload.analysis.recommendations),
      JSON.stringify(payload.analysis.aiSuggestions),
      JSON.stringify(payload.analysis.optimizedBullets),
      JSON.stringify(payload.analysis.keywordPlan),
      payload.analysis.optimizedResumeText,
      payload.analysis.coverLetterText,
      JSON.stringify({
        renderStatus: 'pending',
        renderAttempts: [],
        renderTemplate: payload.jobContext.templateProfile.template,
        renderDensity: payload.jobContext.templateProfile.defaultDensity,
        renderError: '',
        previewReady: false,
        resumeTextSource: '',
      })
    );

    return true;
  }

  // ── Demo Users ────────────────────────────────────────────────
  const demoPassword = await bcrypt.hash('demo1234', 12);
  const proPassword = await bcrypt.hash('pro12345', 12);

  // Free tier demo user
  db.prepare(`
    INSERT OR IGNORE INTO users (email, name, password_hash, tier, credit_balance, is_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('demo@resumexray.com', 'Demo User', demoPassword, 'free', 3, 1);

  // Pro tier demo user
  db.prepare(`
    INSERT OR IGNORE INTO users (email, name, password_hash, tier, credit_balance, is_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('pro@resumexray.com', 'Pro User', proPassword, 'pro', 25, 1);

  // Hustler tier demo user
  db.prepare(`
    INSERT OR IGNORE INTO users (email, name, password_hash, tier, credit_balance, is_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('hustler@resumexray.com', 'Hustler User', proPassword, 'hustler', 100, 1);

  console.log('  ✓ Demo users created');
  console.log('    demo@resumexray.com / demo1234 (free, 3 credits)');
  console.log('    pro@resumexray.com / pro12345 (pro, 25 credits)');
  console.log('    hustler@resumexray.com / pro12345 (hustler, 100 credits)');

  // ── Credit Transactions ───────────────────────────────────────
  const proUser = db.prepare('SELECT id FROM users WHERE email = ?').get('pro@resumexray.com');
  if (proUser) {
    db.prepare(`
      INSERT INTO credit_transactions (user_id, amount, type, description)
      VALUES (?, ?, ?, ?)
    `).run(proUser.id, 25, 'purchase', 'Pro plan — 25 credits');

    db.prepare(`
      INSERT INTO credit_transactions (user_id, amount, type, description)
      VALUES (?, ?, ?, ?)
    `).run(proUser.id, -1, 'scan', 'ATS scan — Software Engineer at Google');
  }

  console.log('  ✓ Sample credit transactions created');
  
  // ── Representative Portal Scans ─────────────────────────────
  if (proUser) {
    const seedScans = [
      {
        jobUrl: 'https://northstar.wd5.myworkdayjobs.com/en-US/Careers/job/Senior-Program-Manager_R-48211',
        jobTitle: 'Senior Program Manager',
        companyName: 'Northstar',
        jobDescription:
          'Job Title: Senior Program Manager\nCompany: Northstar\nDrive hiring workflow automation, recruiter operations analytics, and ATS optimization for a high-growth SaaS team.',
        jobContext: {
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
        },
      },
      {
        jobUrl: 'https://jobs.lever.co/brightpath/9d3412f8-8df7-4f5f-8a8e-platform-ops-manager',
        jobTitle: 'Platform Operations Manager',
        companyName: 'Brightpath',
        jobDescription:
          'Job Title: Platform Operations Manager\nCompany: Brightpath\nOwn ATS workflow design, recruiter tooling, and candidate experience analytics across Lever.',
        jobContext: {
          jobUrl: 'https://jobs.lever.co/brightpath/9d3412f8-8df7-4f5f-8a8e-platform-ops-manager',
          jobTitle: 'Platform Operations Manager',
          companyName: 'Brightpath',
          jdText:
            'Job Title: Platform Operations Manager\nCompany: Brightpath\nOwn ATS workflow design, recruiter tooling, and candidate experience analytics across Lever.',
          jdSource: 'scraped_url',
          scrapeStatus: 'ready',
          scrapeError: '',
          atsPlatform: 'lever',
          atsDisplayName: 'Lever',
          templateProfile: {
            template: 'modern',
            defaultDensity: 'standard',
            singleColumn: true,
            noTables: true,
            strictHeaders: true,
            strictDates: true,
          },
        },
      },
      {
        jobUrl:
          'https://www.linkedin.com/jobs/view/senior-data-analyst-at-northstar-labs-4383701980',
        jobTitle: 'Senior Data Analyst',
        companyName: 'Northstar Labs',
        jobDescription:
          'Job Title: Senior Data Analyst\nCompany: Northstar Labs\nLead applicant funnel analytics, recruiting dashboards, and workflow insights for enterprise customers.',
        jobContext: {
          jobUrl:
            'https://www.linkedin.com/jobs/view/senior-data-analyst-at-northstar-labs-4383701980',
          jobTitle: 'Senior Data Analyst',
          companyName: 'Northstar Labs',
          jdText:
            'Job Title: Senior Data Analyst\nCompany: Northstar Labs\nLead applicant funnel analytics, recruiting dashboards, and workflow insights for enterprise customers.',
          jdSource: 'scraped_url',
          scrapeStatus: 'ready',
          scrapeError: '',
          atsPlatform: 'linkedin',
          atsDisplayName: 'LinkedIn',
          templateProfile: {
            template: 'minimal',
            defaultDensity: 'standard',
            singleColumn: true,
            noTables: true,
            strictHeaders: true,
            strictDates: false,
          },
        },
      },
      {
        jobUrl: 'https://careers.example.com/jobs/applications-ops-manager',
        jobTitle: 'Applications Operations Manager',
        companyName: 'Example Careers',
        jobDescription:
          'Job Title: Applications Operations Manager\nCompany: Example Careers\nImprove job application completion, recruiter operations, and ATS data quality across a multi-brand careers site.',
        jobContext: {
          jobUrl: 'https://careers.example.com/jobs/applications-ops-manager',
          jobTitle: 'Applications Operations Manager',
          companyName: 'Example Careers',
          jdText:
            'Job Title: Applications Operations Manager\nCompany: Example Careers\nImprove job application completion, recruiter operations, and ATS data quality across a multi-brand careers site.',
          jdSource: 'pasted_fallback',
          scrapeStatus: 'blocked',
          scrapeError:
            'This site uses anti-bot protection that blocks automated access. Pasted job description fallback was used.',
          atsPlatform: 'generic',
          atsDisplayName: 'ATS-Optimized',
          templateProfile: {
            template: 'modern',
            defaultDensity: 'standard',
            singleColumn: true,
            noTables: true,
            strictHeaders: true,
            strictDates: true,
          },
        },
      },
    ];

    let insertedCount = 0;
    for (const scan of seedScans) {
      scan.analysis = buildSeedAnalysis({
        companyName: scan.companyName,
        jobTitle: scan.jobTitle,
        atsPlatform: scan.jobContext.atsPlatform,
        atsDisplayName: scan.jobContext.atsDisplayName,
      });
      if (insertSeedScan(proUser.id, scan)) insertedCount++;
    }
    console.log(`  ✓ Representative scan fixtures ready (${insertedCount} new)`);
  }

  console.log('');
  console.log('🎉 Seed complete! Start server with: node server.js');

  closeDb();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
