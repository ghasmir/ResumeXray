const { generatePDF, validatePDF } = require('./resume-builder');
const { hydrateAtsProfile, normalizeJobContext } = require('./jd-processor');

function parseMaybeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function resolveScanJobContext(scan = {}) {
  const context =
    scan.jobContext ||
    scan.job_context ||
    {
      jobUrl: scan.jobUrl || scan.job_url || '',
      jobTitle: scan.jobTitle || scan.job_title || '',
      companyName: scan.companyName || scan.company_name || '',
      jdText: scan.jobDescription || scan.job_description || '',
      atsPlatform: scan.atsPlatform || scan.ats_platform || '',
    };

  return normalizeJobContext(parseMaybeJson(context, context));
}

function resolveRenderMeta(scan = {}) {
  const meta = parseMaybeJson(scan.renderMeta || scan.render_meta || {}, {});
  return {
    renderStatus: meta.renderStatus || 'pending',
    renderAttempts: Array.isArray(meta.renderAttempts) ? meta.renderAttempts : [],
    renderTemplate: meta.renderTemplate || '',
    renderDensity: meta.renderDensity || '',
    renderError: meta.renderError || '',
    previewReady: meta.previewReady === true,
    resumeTextSource: meta.resumeTextSource || '',
    validation: meta.validation || null,
  };
}

function getExpectedName(scan = {}) {
  const sectionData = parseMaybeJson(scan.sectionData || scan.section_data || {}, {});
  const xrayData = parseMaybeJson(scan.xrayData || scan.xray_data || {}, {});
  return (
    sectionData.name ||
    xrayData?.extractedFields?.Name ||
    xrayData?.engines?.enhancedParser?.Contact?.name ||
    ''
  );
}

function buildStructuredResumeText(scan = {}) {
  const xrayData = parseMaybeJson(scan.xrayData || scan.xray_data || {}, {});
  const enhanced = xrayData?.engines?.enhancedParser || {};
  const contact = enhanced.Contact || {};
  const lines = [];

  const name = contact.name || xrayData?.extractedFields?.Name || '';
  if (name) lines.push(name);

  const contactLine = [
    contact.email || xrayData?.extractedFields?.Email || '',
    contact.phone || xrayData?.extractedFields?.Phone || '',
    contact.linkedin || xrayData?.extractedFields?.LinkedIn || '',
    contact.location || xrayData?.extractedFields?.Location || '',
  ]
    .filter(Boolean)
    .join(' | ');

  if (contactLine) lines.push(contactLine);

  const sections = [
    ['PROFESSIONAL SUMMARY', enhanced.Summary],
    ['EXPERIENCE', enhanced.Experience],
    ['EDUCATION', enhanced.Education],
    ['TECHNICAL SKILLS', enhanced.Skills],
    ['PROJECTS', enhanced.Projects],
  ];

  for (const [label, value] of sections) {
    const text = String(value || '').trim();
    if (!text) continue;
    lines.push('', label, text);
  }

  return lines.join('\n').trim();
}

function resolveResumeText(scan = {}) {
  const optimized = String(scan.optimizedResumeText || scan.optimized_resume_text || '').trim();
  if (optimized.length >= 120) {
    return { resumeText: optimized, source: 'optimized_resume_text' };
  }

  const structured = buildStructuredResumeText(scan);
  if (structured.length >= 120) {
    return { resumeText: structured, source: 'structured_fallback' };
  }

  return { resumeText: optimized || structured, source: 'unavailable' };
}

function buildRenderAttempts(jobContext) {
  const atsProfile = hydrateAtsProfile({
    name: jobContext.atsPlatform,
    displayName: jobContext.atsDisplayName,
    templateProfile: jobContext.templateProfile,
  });

  return [
    {
      label: 'resolved-profile',
      template: jobContext.templateProfile?.template || atsProfile.template,
      density: jobContext.templateProfile?.defaultDensity || atsProfile.defaultDensity || 'standard',
      atsProfile,
    },
    {
      label: 'strict-fallback',
      template: 'minimal',
      density: 'compact',
      atsProfile: hydrateAtsProfile({
        ...atsProfile,
        template: 'minimal',
        defaultDensity: 'compact',
        singleColumn: true,
        noTables: true,
        strictHeaders: true,
        strictDates: true,
      }),
    },
  ];
}

async function renderResumePdf(scan, options = {}) {
  const jobContext = resolveScanJobContext(scan);
  const renderMeta = resolveRenderMeta(scan);
  const sectionData = parseMaybeJson(scan.sectionData || scan.section_data || {}, {});
  const optimizedBullets = parseMaybeJson(
    scan.optimizedBullets || scan.optimized_bullets || [],
    []
  );
  const keywordPlan = parseMaybeJson(scan.keywordPlan || scan.keyword_plan || [], []);
  const expectedName = getExpectedName(scan);
  const { resumeText, source } = resolveResumeText(scan);

  if (!resumeText || resumeText.trim().length < 80) {
    const error = 'Optimized resume content is not ready yet. Please rerun the scan for this job.';
    const failedMeta = {
      ...renderMeta,
      renderStatus: 'failed',
      renderError: error,
      previewReady: false,
      resumeTextSource: source,
    };
    throw Object.assign(new Error(error), { renderMeta: failedMeta });
  }

  const attempts = [];
  const renderAttempts = buildRenderAttempts(jobContext);

  for (const attempt of renderAttempts) {
    try {
      const buffer = await generatePDF(resumeText, sectionData, optimizedBullets, keywordPlan, {
        watermark: options.watermark === true,
        density: attempt.density,
        template: attempt.template,
        jobUrl: jobContext.jobUrl || '',
        atsProfile: attempt.atsProfile,
        jobContext,
      });

      const validation = await validatePDF(buffer, {
        expectedName,
        maxPages: 2,
        minTextLength: 90,
      });

      attempts.push({
        label: attempt.label,
        template: attempt.template,
        density: attempt.density,
        valid: validation.valid,
        pageCount: validation.pageCount || null,
        textLength: validation.textLength || 0,
        error: validation.error || '',
      });

      if (validation.valid) {
        return {
          buffer,
          renderMeta: {
            ...renderMeta,
            renderStatus: 'ready',
            renderAttempts: attempts,
            renderTemplate: attempt.template,
            renderDensity: attempt.density,
            renderError: '',
            previewReady: true,
            resumeTextSource: source,
            validation: {
              pageCount: validation.pageCount || null,
              textLength: validation.textLength || 0,
              matchRate: validation.matchRate || 0,
            },
          },
        };
      }
    } catch (error) {
      attempts.push({
        label: attempt.label,
        template: attempt.template,
        density: attempt.density,
        valid: false,
        pageCount: null,
        textLength: 0,
        error: error.message,
      });
    }
  }

  const finalError =
    attempts[attempts.length - 1]?.error ||
    'We could not generate a readable ATS preview for this scan.';
  throw Object.assign(new Error(finalError), {
    renderMeta: {
      ...renderMeta,
      renderStatus: 'failed',
      renderAttempts: attempts,
      renderTemplate: attempts[attempts.length - 1]?.template || '',
      renderDensity: attempts[attempts.length - 1]?.density || '',
      renderError: finalError,
      previewReady: false,
      resumeTextSource: source,
    },
  });
}

module.exports = {
  buildStructuredResumeText,
  parseMaybeJson,
  renderResumePdf,
  resolveRenderMeta,
  resolveResumeText,
  resolveScanJobContext,
};
