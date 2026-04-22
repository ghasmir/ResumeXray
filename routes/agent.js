/**
 * Agent Routes — SSE-based streaming agent pipeline.
 * POST /agent/start   → Upload resume + JD, returns sessionId
 * GET  /agent/stream/:sessionId → SSE stream of analysis + fixes
 * GET  /agent/download/:scanId  → Download optimized resume (DOCX/PDF)
 *
 * Value Wall Implementation:
 * - Scans are FREE (shows ATS score + knockout risks)
 * - AI bullet rewrites: 1 free teaser, rest require credits
 * - PDF/DOCX export: requires 1 credit (watermarked without)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { upload, validateMagicBytes } = require('../middleware/upload');
const { agentLimiter, downloadLimiter, sanitizeInput } = require('../config/security');
const { checkExportCredit } = require('../middleware/usage');
const parser = require('../lib/parser');
const {
  hydrateAtsProfile,
  normalizeJobContext,
  processJobDescription,
  sanitizeCompanyNameValue,
  sanitizeJobTitleValue,
} = require('../lib/jd-processor');
const { validateResumeContent } = require('../lib/resume-validator');
const { runAgentPipeline } = require('../lib/agent-pipeline');
const {
  generateDOCX,
  renderHtmlToPdf,
} = require('../lib/resume-builder');
const { parseCoverLetter } = require('../lib/cover-letter-parser');
const {
  renderResumePdf,
  resolveResumeText,
  resolveScanJobContext,
} = require('../lib/render-service');
const { renderTemplate } = require('../lib/template-renderer');
const db = require('../db/database');
const log = require('../lib/logger');

// §9.5: Track active SSE connections per user for concurrent stream limiting
const activeStreams = new Map(); // userId|ip → Set<res>
const EXPORT_VARIANT_VERSION = 'theme-v2';

// Helper: parse and validate scanId from URL params
function parseScanId(raw) {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeTemplateChoice(raw) {
  const value = sanitizeInput(String(raw || '')).toLowerCase();
  return ['refined', 'executive', 'corporate', 'modern', 'classic', 'minimal'].includes(value) ? value : '';
}

function normalizeDensityChoice(raw) {
  const value = sanitizeInput(String(raw || '')).toLowerCase();
  return ['standard', 'compact'].includes(value) ? value : '';
}

function sendEmbeddedState(res, statusCode, { title, message, accent = '#8b5cf6' }) {
  return res.status(statusCode).setHeader('Content-Type', 'text/html; charset=utf-8').send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${sanitizeInput(title)}</title>
        <style>
          :root { color-scheme: dark; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: radial-gradient(circle at top, rgba(99, 91, 255, 0.18), transparent 32%), #0b0b12;
            color: #f5f7fb;
          }
          .state-card {
            width: min(100%, 480px);
            padding: 32px 28px;
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(22, 22, 32, 0.94);
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
            text-align: center;
          }
          .state-icon {
            width: 58px;
            height: 58px;
            margin: 0 auto 18px;
            display: grid;
            place-items: center;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.04);
            color: ${accent};
          }
          h1 {
            margin: 0 0 10px;
            font-size: 1.125rem;
            line-height: 1.2;
            letter-spacing: -0.02em;
          }
          p {
            margin: 0;
            color: rgba(231, 234, 243, 0.78);
            font-size: 0.94rem;
            line-height: 1.6;
          }
        </style>
      </head>
      <body>
        <div class="state-card">
          <div class="state-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="11" x2="12" y2="15" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </div>
          <h1>${sanitizeInput(title)}</h1>
          <p>${sanitizeInput(message)}</p>
        </div>
      </body>
    </html>
  `);
}

function readJobContext(rawJobContext, fallback = {}) {
  if (!rawJobContext) return normalizeJobContext(fallback);
  if (typeof rawJobContext === 'object') return normalizeJobContext(rawJobContext);
  try {
    return normalizeJobContext(JSON.parse(rawJobContext));
  } catch {
    return normalizeJobContext(fallback);
  }
}

function buildSessionJobContext(dbSession) {
  return readJobContext(dbSession.job_context, {
    jobUrl: dbSession.job_url,
    jobTitle: dbSession.job_title,
    companyName: dbSession.company_name,
    jdText: dbSession.jd_text,
    atsPlatform: dbSession.ats_platform || '',
  });
}

function buildExportIdempotencyKey(scanId, format, exportType, template, density) {
  return [
    'export',
    scanId,
    String(format || 'pdf').toLowerCase(),
    String(exportType || 'resume').toLowerCase(),
    String(template || 'refined').toLowerCase(),
    String(density || 'standard').toLowerCase(),
    EXPORT_VARIANT_VERSION,
  ].join('-');
}

function buildCoverLetterContext(scan = {}) {
  const sectionData = scan.section_data || {};
  let name = sectionData?.name || '';
  let contact = sectionData?.contact || '';

  if (!name && scan.xray_data?.extractedFields?.Name) {
    name = scan.xray_data.extractedFields.Name;
  }
  if (!contact) {
    const extractedFields = scan.xray_data?.extractedFields || {};
    const parts = [extractedFields.Email, extractedFields.Phone].filter(Boolean);
    if (parts.length) contact = parts.join(' | ');
  }

  return {
    name,
    contact,
    jobTitle: sanitizeJobTitleValue(scan.job_title || ''),
    companyName: sanitizeCompanyNameValue(scan.company_name || ''),
  };
}

function jobContextNeedsManualPaste(jobContext) {
  return (
    !!jobContext.jobUrl &&
    !jobContext.jdText &&
    ['blocked', 'failed'].includes(jobContext.scrapeStatus)
  );
}

// ── Session + Upload Storage (Phase 3: DB Sessions + Disk Uploads) ────────────
// Resume buffers are written to disk (prevents OOM with concurrent uploads).
// Session data is persisted in SQLite scan_sessions table (survives restarts).

const UPLOAD_TMP = path.join(__dirname, '..', 'tmp_uploads');
if (!fs.existsSync(UPLOAD_TMP)) fs.mkdirSync(UPLOAD_TMP, { recursive: true });

// Periodic cleanup: purge expired sessions + stale temp files (every 2 min)
setInterval(
  async () => {
    try {
      await db.purgeExpiredScanSessions();
    } catch (err) {
      log.warn('Session purge failed', { error: err.message });
    }
    // Clean up orphaned temp files older than 15 minutes
    try {
      const files = fs.readdirSync(UPLOAD_TMP);
      const cutoff = Date.now() - 15 * 60 * 1000;
      for (const f of files) {
        const fPath = path.join(UPLOAD_TMP, f);
        const stat = fs.statSync(fPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fPath);
        }
      }
    } catch {
      /* ignore cleanup errors */
    }
  },
  2 * 60 * 1000
);

// ── POST /agent/start — Upload + parse, return sessionId ──────────────────────

router.get('/job-context', agentLimiter, async (req, res) => {
  try {
    const jobUrl = sanitizeInput(String(req.query.jobUrl || ''));
    const jobDescription = sanitizeInput(String(req.query.jobDescription || ''));

    if (!jobUrl && !jobDescription) {
      return res.status(400).json({ error: 'Job URL or pasted JD is required.' });
    }

    if (jobUrl && jobUrl.length > 2048) {
      return res.status(400).json({ error: 'Job URL is too long (max 2048 characters).' });
    }

    const jdResult = await processJobDescription(jobDescription || jobUrl, '', jobUrl);
    const jobContext = jdResult.jobContext;

    return res.json({
      success: true,
      jobContext,
      needsJobDescription: jobContextNeedsManualPaste(jobContext),
      canProceed: !!jobContext.jdText || !jobContext.jobUrl,
    });
  } catch (err) {
    log.warn('Job context preflight failed', { error: err.message });
    return res.status(400).json({ error: err.message || 'Unable to inspect that job link.' });
  }
});

router.post('/start', agentLimiter, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please submit a resume file (PDF or DOCX).' });
    }

    // Security: Validate file magic bytes (prevents MIME spoofing)
    if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({
        error:
          'File integrity check failed. The file appears corrupted or is not a valid PDF/DOCX.',
      });
    }

    const rawText = await parser.parseResume(req.file.buffer, req.file.mimetype);
    if (!rawText || rawText.trim() === '') {
      return res
        .status(400)
        .json({ error: 'Could not extract text. Ensure it is not an image-based PDF.' });
    }

    // Content validation: reject non-resume files
    const validation = validateResumeContent(rawText);
    if (!validation.isResume) {
      return res.status(400).json({
        error: `This doesn't appear to be a resume. Please upload your resume file (PDF or DOCX) containing your work experience, education, and skills.`,
      });
    }

    // §10.11: Input length validation — prevent oversized payloads before LLM processing
    let jdText = '';
    let jobUrl = req.body.jobUrl || '';
    let jobTitle = '';
    let companyName = sanitizeInput(req.body.companyName || '');
    let jobContext = normalizeJobContext({
      jobUrl,
      jobTitle,
      companyName,
      jdText: '',
      jdSource: 'none',
      scrapeStatus: jobUrl ? 'pending' : 'not_requested',
    });
    const jdInput = req.body.jobDescription || jobUrl || '';

    if (!String(jdInput || '').trim()) {
      return res.status(400).json({
        error:
          'Add a job link or paste the job description so we can optimize the resume for a real application.',
      });
    }

    if (jobUrl && jobUrl.length > 2048) {
      return res.status(400).json({ error: 'Job URL is too long (max 2048 characters).' });
    }
    if (jdInput.length > 50000) {
      return res
        .status(400)
        .json({ error: 'Job description is too long (max 50,000 characters).' });
    }

    if (jdInput.trim()) {
      const jdResult = await processJobDescription(jdInput, '', jobUrl);
      jdText = jdResult.jdText;
      jobUrl = jdResult.jobUrl || jobUrl;
      jobTitle = jdResult.jobTitle || '';
      companyName = jdResult.companyName || companyName;
      jobContext = jdResult.jobContext;
    }

    if (jobContextNeedsManualPaste(jobContext)) {
      return res.status(400).json({
        error:
          jobContext.scrapeError ||
          'We could not fetch that job listing automatically. Paste the job description text to continue.',
        needsJobDescription: true,
        jobContext,
      });
    }

    // Guest scan limit (2 free scans per IP per day)
    if (!req.user) {
      // M-9: Use req.ip only — trust proxy=1 ensures Express resolves the correct
      // client IP from Cloudflare/Caddy. Falling back to x-forwarded-for is spoofable.
      const ip = req.ip || 'unknown';
      const guestCount = await db.getGuestScanCount(ip);
      if (guestCount >= 2) {
        return res
          .status(429)
          .json({ error: 'Free guest preview limit reached for today. Create a free account to continue.', signup: true });
      }
    }

    // Determine credit balance for value wall decisions
    const creditBalance = req.user ? await db.getCreditBalance(req.user.id) : 0;

    const sessionId = uuidv4();

    // Phase 3 #12: Write buffer to disk instead of keeping in memory
    // Sanitize filename to prevent path traversal
    const safeName = req.file.originalname.replace(/[^a-z0-9._-]/gi, '_').substring(0, 100);
    const tmpPath = path.join(UPLOAD_TMP, `${sessionId}-${safeName}`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    // Phase 3 #13: Persist session in database (survives server restart)
    await db.createScanSession(sessionId, {
      resumeText: rawText,
      resumeFilePath: tmpPath,
      resumeMimetype: req.file.mimetype,
      fileName: req.file.originalname,
      jdText: sanitizeInput(jdText),
      jobUrl: jobContext.jobUrl || sanitizeInput(jobUrl),
      jobTitle: jobContext.jobTitle || sanitizeInput(jobTitle),
      companyName: jobContext.companyName || companyName,
      jobContext,
      userId: req.user ? req.user.id : null,
      creditBalance,
    });

    // Phase 6 §3.1-A: Track scan session for guest IDOR protection
    // Store sessionId in browser session so we can tie scans to this browser later.
    if (!req.user && req.session) {
      if (!req.session.guestScanTokens) req.session.guestScanTokens = [];
      // We'll push the actual access_token after scan creation in /stream
      req.session.guestSessionIds = req.session.guestSessionIds || [];
      req.session.guestSessionIds.push(sessionId);
    }

    res.json({ success: true, sessionId, creditBalance, jobContext });
  } catch (err) {
    log.error('Agent start error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to start analysis.' });
  }
});

// ── GET /agent/stream/:sessionId — SSE streaming pipeline ─────────────────────

router.get('/stream/:sessionId', agentLimiter, async (req, res) => {
  const dbSession = await db.getScanSession(req.params.sessionId);
  if (!dbSession) {
    return res.status(404).json({ error: 'Session expired or not found.' });
  }

  // Phase 6 §9.1: SSE Auth — verify the requesting session owns this scan session.
  // Logged-in user: must match userId. Guest: must have sessionId in their browser session.
  const requestUserId = req.user ? req.user.id : null;
  const sessionUserId = dbSession.user_id;

  if (sessionUserId) {
    // Logged-in scan: only the owning user can stream
    if (!requestUserId || requestUserId !== sessionUserId) {
      log.warn('SSE auth rejected: userId mismatch', { requestUserId, sessionUserId });
      return res.status(403).json({ error: 'Unauthorized stream access.' });
    }
  } else {
    // Guest scan: verify the sessionId is tracked in this browser session
    const guestSessionIds = req.session?.guestSessionIds || [];
    if (!guestSessionIds.includes(req.params.sessionId)) {
      log.warn('SSE auth rejected: guest sessionId not in browser session', {
        sessionId: req.params.sessionId,
      });
      return res.status(403).json({ error: 'Unauthorized stream access.' });
    }
  }

  // Map DB column names → camelCase for pipeline compatibility
  const jobContext = buildSessionJobContext(dbSession);
  const session = {
    resumeText: dbSession.resume_text,
    resumeFilePath: dbSession.resume_file_path,
    resumeMimetype: dbSession.resume_mimetype,
    fileName: dbSession.file_name,
    jdText: jobContext.jdText || dbSession.jd_text,
    jobUrl: jobContext.jobUrl || dbSession.job_url,
    jobTitle: jobContext.jobTitle || dbSession.job_title,
    companyName: jobContext.companyName || dbSession.company_name,
    jobContext,
    userId: dbSession.user_id,
    creditBalance: dbSession.credit_balance,
    atsProfile: hydrateAtsProfile({
      name: jobContext.atsPlatform,
      displayName: jobContext.atsDisplayName,
      templateProfile: jobContext.templateProfile,
    }),
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // §9.5: Enforce max 2 concurrent SSE streams per user
  const streamKey = session.userId ? `u:${session.userId}` : `ip:${req.ip}`;
  if (!activeStreams.has(streamKey)) activeStreams.set(streamKey, new Set());
  const userStreams = activeStreams.get(streamKey);
  if (userStreams.size >= 2) {
    log.warn('SSE concurrent limit exceeded', { streamKey, active: userStreams.size });
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: 'Too many active scans. Close other tabs and retry.' })}\n\n`
    );
    return res.end();
  }
  userStreams.add(res);

  // §9.2: Heartbeat — send `: ping` every 15s to keep Cloudflare/proxies alive
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  // §9.7: Max SSE lifetime — force-close after 5 minutes
  const maxLifetime = setTimeout(
    () => {
      if (!res.writableEnded) {
        log.warn('SSE max lifetime exceeded, force-closing', { streamKey });
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: 'Stream timeout. Please retry.' })}\n\n`
        );
        res.end();
      }
    },
    5 * 60 * 1000
  );

  res.write(':\n\n');

  // v3: AI Sandbox is FREE — no bullet rewrite limits
  // All bullet rewrites run without credit deduction
  // Credits are only consumed when user exports final PDF/DOCX
  const maxBulletRewrites = 10; // Max rewrites per scan

  // §9.3: Backpressure-aware write — prevents unbounded buffer growth
  // §9.4: Event IDs for Last-Event-ID reconnection
  let eventId = 0;
  function sseWrite(event, data) {
    if (res.writableEnded) return Promise.resolve();
    eventId++;
    const msg = `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const ok = res.write(msg);
    if (!ok && !res.writableEnded) {
      return new Promise(resolve => res.once('drain', resolve));
    }
    return Promise.resolve();
  }

  const emitter = {
    async emitStep(step, name, status, label, data = null) {
      const payload = { step, name, status, label };
      if (data) payload.data = data;
      await sseWrite('step', payload);
    },
    async emitToken(step, name, chunk, bulletIndex) {
      const payload = { step, name, chunk };
      if (bulletIndex !== undefined) payload.bulletIndex = bulletIndex;
      await sseWrite('token', payload);
    },
    async emitBullet(step, index, status, original, rewritten, method, targetKeyword) {
      const payload = { step, index, status, original };
      if (rewritten) payload.rewritten = rewritten;
      if (method) payload.method = method;
      if (targetKeyword) payload.targetKeyword = targetKeyword;
      await sseWrite('bullet', payload);
    },
    async emitScores(scores) {
      await sseWrite('scores', scores);
    },
    async emitInit(scanId, accessTokenValue = null) {
      await sseWrite('init', { scanId, accessToken: accessTokenValue || null });
    },
    async emitJobContext(jobContextValue) {
      await sseWrite('jobContext', jobContextValue);
    },
    async emitRenderProfile(renderProfile) {
      await sseWrite('renderProfile', renderProfile);
    },
    async emitComplete(scanId) {
      const creditBalance = session.userId ? await db.getCreditBalance(session.userId) : 0;
      const canDownloadClean = creditBalance >= 1;
      await sseWrite('complete', {
        scanId,
        canDownloadClean,
        downloadUrl: `/api/agent/download/${scanId}`,
        creditBalance,
        isWatermarked: !canDownloadClean,
        resumeText: session.resumeText,
        hasCoverLetter: true,
        previewReady: true,
        jobContext: session.jobContext,
        accessToken: accessToken || null, // For guest scan preview URLs (IDOR protection)
      });
    },
    async emitError(message, step) {
      await sseWrite('error', { message, step });
    },
    async emitCoverLetter(text) {
      await sseWrite('coverLetter', { text });
    },
    async emitAtsProfile(atsProfile) {
      await sseWrite('atsProfile', {
        name: atsProfile.name,
        displayName: atsProfile.displayName,
        template: atsProfile.template,
      });
    },
  };

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  // H-2 Fix: Single idempotent cleanup function called from BOTH res.on('close')
  // and the finally block. Using a flag prevents double-execution of clearInterval/
  // clearTimeout and Set.delete which would otherwise race.
  let cleanupDone = false;
  function sseCleanup() {
    if (cleanupDone) return;
    cleanupDone = true;
    clearInterval(heartbeat);
    clearTimeout(maxLifetime);
    userStreams.delete(res);
    if (userStreams.size === 0) activeStreams.delete(streamKey);
  }
  // Fire cleanup immediately if the client disconnects before pipeline finishes
  res.on('close', () => {
    aborted = true;
    sseCleanup();
  });

  // ── EARLY PERSISTENCE ──
  // Save a placeholder scan immediately so we have a persistent ID
  let resumeId = null;
  if (session.userId) {
    resumeId = await db.saveResume(session.userId, {
      name: session.fileName,
      fileName: session.fileName,
      fileType: session.resumeMimetype === 'application/pdf' ? 'pdf' : 'docx',
      fileSize: session.resumeFilePath ? fs.statSync(session.resumeFilePath).size : 0,
      rawText: session.resumeText,
      parsedData: {},
    });
  }

  const scanResult = await db.saveScan(session.userId, {
    resumeId,
    jobDescription: session.jdText,
    jobUrl: session.jobUrl,
    jobTitle: session.jobTitle,
    companyName: session.companyName,
    atsPlatform: session.jobContext.atsPlatform,
    jobContext: session.jobContext,
    parseRate: 0,
    formatHealth: 0,
    matchRate: 0,
    xrayData: {},
    formatIssues: [],
    keywordData: {},
    sectionData: {},
    recommendations: [],
    aiSuggestions: null,
    renderMeta: {
      renderStatus: 'pending',
      renderAttempts: [],
      renderTemplate: session.jobContext.templateProfile?.template || '',
      renderDensity: session.jobContext.templateProfile?.defaultDensity || '',
      renderError: '',
      previewReady: false,
      resumeTextSource: '',
    },
  });

  const scanId = scanResult.scanId;
  const accessToken = scanResult.accessToken;

  // Phase 6 §3.1-A: Store guest scan access token in session for IDOR-safe claiming.
  // When this guest later signs up, only scans with tokens in their session will be claimed.
  if (!session.userId && accessToken && req.session) {
    if (!req.session.guestScanTokens) req.session.guestScanTokens = [];
    req.session.guestScanTokens.push(accessToken);
    // H-4 Fix: await session.save() properly — fire-and-forget silently drops
    // the token if the async store (Supabase/Redis) hasn't flushed before SSE ends.
    await new Promise(resolve => {
      req.session.save(err => {
        if (err) log.warn('Guest scan token session save failed', { error: err.message });
        resolve();
      });
    });
  }

  log.info('Scan created', { scanId, userId: session.userId });

  // Let the frontend know our persistent ID
  await emitter.emitInit(scanId, accessToken);
  await emitter.emitJobContext(session.jobContext);
  await emitter.emitRenderProfile({
    template: session.jobContext.templateProfile?.template || 'refined',
    density: session.jobContext.templateProfile?.defaultDensity || 'standard',
    atsPlatform: session.jobContext.atsPlatform,
    atsDisplayName: session.jobContext.atsDisplayName,
    previewStatus: 'pending',
  });

  try {
    const results = await runAgentPipeline(session.resumeText, session.jdText, emitter, {
      maxBulletRewrites,
      limitKeywords: 5,
      atsProfile: session.atsProfile,
      jobContext: session.jobContext,
    });

    if (aborted) return;

    // Update database with final results
    if (session.userId && resumeId) {
      // Optional: update parsedData in resume record if needed
    }

    await db.updateScan(scanId, {
      jobDescription: session.jdText,
      jobUrl: session.jobUrl,
      jobTitle: session.jobTitle,
      companyName: session.companyName,
      atsPlatform: session.jobContext.atsPlatform,
      jobContext: session.jobContext,
      parseRate: results.parseRate,
      formatHealth: results.formatHealth,
      matchRate: results.matchRate,
      xrayData: results.xrayData,
      formatIssues: results.formatIssues,
      keywordData: results.keywordData,
      sectionData: results.sectionData,
      recommendations: results.recommendations,
      aiSuggestions: {
        biasShield: results.biasShield,
        aiShieldData: results.aiShieldData,
      },
    });

    await db.updateScanWithOptimizations(scanId, {
      optimizedBullets: results.optimizedBullets,
      keywordPlan: results.keywordPlan,
      optimizedResumeText: results.optimizedResumeText,
      coverLetterText: results.coverLetter || null,
      atsPlatform: results.atsProfile?.name || null,
      jobContext: session.jobContext,
    });

    // v3: No credit deduction for AI rewrites — they're free (sandbox mode)
    // Credits are only deducted on final export in the download route
    // Still track scan usage
    if (session.userId) {
      await db.incrementScanCount(session.userId);
    } else {
      // M-2 Fix: Use req.ip only — trust proxy=1 ensures correct IP from Cloudflare.
      // Falling back to x-forwarded-for directly is unsafe and can be spoofed.
      const ip = req.ip || 'unknown';
      await db.recordGuestScan(ip);
    }

    await emitter.emitComplete(scanId);
  } catch (err) {
    log.error('Agent stream error', { error: err.message, scanId });
    emitter.emitError('Analysis failed: ' + err.message);
  } finally {
    // Phase 3: Clean up DB session + temp file
    await db.deleteScanSession(req.params.sessionId);
    if (session.resumeFilePath) {
      try {
        fs.unlinkSync(session.resumeFilePath);
      } catch {
        /* already cleaned */
      }
    }
    // H-2 Fix: Use the idempotent sseCleanup() — safe to call even if res.on('close')
    // already fired it. Then end the response.
    sseCleanup();
    res.end();
  }
});

// ── GET /agent/preview/:scanId — Inline PDF Preview ────────────

router.get('/preview/:scanId', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const scanId = parseScanId(req.params.scanId);
    const accessToken = typeof req.query.token === 'string' ? req.query.token : null;
    const preferredTemplate = normalizeTemplateChoice(req.query.template);
    const preferredDensity = normalizeDensityChoice(req.query.density);
    if (!scanId) {
      return sendEmbeddedState(res, 400, {
        title: 'Preview unavailable',
        message: 'We could not open this export preview because the scan reference is invalid.',
      });
    }
    const scan = await db.getFullScan(scanId, userId, accessToken);
    if (!scan) {
      return sendEmbeddedState(res, 404, {
        title: 'Preview unavailable',
        message: 'This scan could not be found. Start a new scan and we will rebuild the preview.',
      });
    }

    // SECURITY: Guest scans require a valid access token (prevents IDOR)
    if (!userId && scan.access_token) {
      const providedToken = req.query.token;
      if (scan.access_token !== providedToken) {
        return sendEmbeddedState(res, 403, {
          title: 'Preview session expired',
          message:
            'This guest preview is missing its secure access token. Return to the active results workspace or start a fresh scan to rebuild it.',
          accent: '#f59e0b',
        });
      }
    }

    const { buffer, renderMeta } = await renderResumePdf(scan, {
      watermark: true,
      template: preferredTemplate || undefined,
      density: preferredDensity || undefined,
    });
    await db.updateScan(scanId, {
      jobContext: resolveScanJobContext(scan),
      renderMeta,
    });

    res.setHeader('Content-Type', 'application/pdf');
    // 'inline' tells the browser to display it in the iframe instead of downloading
    res.setHeader('Content-Disposition', `inline; filename="optimized-preview.pdf"`);
    res.send(buffer);
  } catch (err) {
    const scanId = parseScanId(req.params.scanId);
    if (scanId && err.renderMeta) {
      try {
        await db.updateScan(scanId, { renderMeta: err.renderMeta });
      } catch {
        /* ignore preview metadata persistence errors */
      }
    }

    log.error('Preview error', { error: err.message, stack: err.stack, scanId: req.params.scanId });

    // Fallback: serve an in-iframe HTML error page (NOT the resume HTML — that breaks the iframe)
    // The previous approach sent text/html resume HTML to an iframe expecting application/pdf,
    // causing the browser to show a broken file icon.
    res.status(500).send(`
      <!DOCTYPE html><html><head><style>
        body { margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh;
               font-family:-apple-system,BlinkMacSystemFont,sans-serif; background:#1a1a1f; color:#e1e1e8; }
        .msg { text-align:center; padding:2rem; max-width:400px; }
        .msg svg { opacity:0.35; margin-bottom:1.25rem; }
        .msg h3 { margin:0 0 0.6rem; font-size:1rem; font-weight:600; }
        .msg p { color:#888; font-size:0.85rem; line-height:1.6; margin:0; }
      </style></head><body>
        <div class="msg">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="12" y1="9" x2="12.01" y2="9"/>
          </svg>
          <h3>PDF Preview Unavailable</h3>
          <p>${sanitizeInput(err.message || 'The renderer could not build a readable preview for this scan just yet.')}</p>
        </div>
      </body></html>
    `);
  }
});

// ── GET /agent/cover-letter-preview/:scanId — Inline HTML Preview ────────────

router.get('/cover-letter-preview/:scanId', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const scanId = parseScanId(req.params.scanId);
    const accessToken = typeof req.query.token === 'string' ? req.query.token : null;
    if (!scanId) {
      return sendEmbeddedState(res, 400, {
        title: 'Cover letter unavailable',
        message: 'We could not open this cover-letter preview because the scan reference is invalid.',
      });
    }
    const scan = await db.getFullScan(scanId, userId, accessToken);
    const preferredTemplate = normalizeTemplateChoice(req.query.template);
    const preferredDensity = normalizeDensityChoice(req.query.density);
    if (!scan) {
      return sendEmbeddedState(res, 404, {
        title: 'Cover letter unavailable',
        message: 'This scan could not be found. Start a fresh scan with a target job to generate a letter.',
      });
    }

    // SECURITY: Guest scans require a valid access token (prevents IDOR)
    if (!userId && scan.access_token) {
      const providedToken = req.query.token;
      if (scan.access_token !== providedToken) {
        return sendEmbeddedState(res, 403, {
          title: 'Cover letter session expired',
          message:
            'This guest cover-letter preview is missing its secure access token. Return to the active results workspace or start a fresh scan to rebuild it.',
          accent: '#f59e0b',
        });
      }
    }

    if (!scan.cover_letter_text || !String(scan.cover_letter_text).trim()) {
      return sendEmbeddedState(res, 200, {
        title: 'No cover letter generated yet',
        message:
          'This scan does not contain a cover letter yet. Add a target job description so we can generate one for the role.',
        accent: '#94a3b8',
      });
    }

    const jobContext = resolveScanJobContext(scan);
    const resolvedTemplate =
      preferredTemplate || jobContext.templateProfile?.template || 'refined';
    const resolvedDensity =
      preferredDensity || jobContext.templateProfile?.defaultDensity || 'standard';
    const parsed = parseCoverLetter(scan.cover_letter_text || '', buildCoverLetterContext(scan));
    const html = renderTemplate('cover-letter', parsed, {
      watermark: false,
      density: resolvedDensity,
      template: resolvedTemplate,
    });

    const protectionCss = `
      html, body {
        overflow-x: hidden !important;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      body::after {
        content: 'ResumeXray Preview';
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-35deg);
        font-size: 3.5rem;
        font-weight: 900;
        color: rgba(148, 163, 184, 0.08);
        pointer-events: none;
        z-index: 9999;
        white-space: nowrap;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
    `;

    const protectedHtml = html.replace(
      '</head>',
      `
      <style>${protectionCss}</style>
    </head>`
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(protectedHtml);
  } catch (err) {
    log.error('Cover letter preview error', { error: err.message, scanId: req.params.scanId });
    res.status(500).send('Failed to generate cover letter preview.');
  }
});

// ── GET /agent/download/:scanId — Generate and serve optimized resume ─────────

router.get('/download/:scanId', downloadLimiter, checkExportCredit, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const scanId = parseScanId(req.params.scanId);
    const accessToken = typeof req.query.token === 'string' ? req.query.token : null;
    if (!scanId) return res.status(400).json({ error: 'Invalid scan ID.' });
    const scan = await db.getFullScan(scanId, userId, accessToken);
    if (!scan) return res.status(404).json({ error: 'Scan not found.' });

    const format = req.query.format || 'docx';
    const exportType = req.query.type || 'resume'; // 'resume' or 'cover_letter'
    const preferredTemplate = normalizeTemplateChoice(req.query.template);
    const preferredDensity = normalizeDensityChoice(req.query.density);
    const resolvedJobContext = resolveScanJobContext(scan);
    const resolvedTemplate =
      preferredTemplate || resolvedJobContext.templateProfile?.template || 'refined';
    const resolvedDensity =
      preferredDensity || resolvedJobContext.templateProfile?.defaultDensity || 'standard';
    const { resumeText } = resolveResumeText(scan);
    const sectionData = scan.section_data || {};
    const optimizedBullets = scan.optimized_bullets || [];
    const keywordPlan = scan.keyword_plan || [];

    // Atomic credit deduction with idempotency key (prevents double-deduction)
    if (req.user) {
      const idempotencyKey = buildExportIdempotencyKey(
        req.params.scanId,
        format,
        exportType,
        resolvedTemplate,
        resolvedDensity
      );
      const result = await db.deductCreditAtomic(
        req.user.id,
        'export',
        idempotencyKey,
        `Exported ${format.toUpperCase()} ${exportType} (${resolvedTemplate}/${resolvedDensity})`
      );

      if (!result.success && !result.alreadyProcessed) {
        // Insufficient credits — block download entirely (don't serve watermarked file)
        return res.status(402).json({
          error: 'You have no credits remaining. Purchase credits to download your files.',
          upgrade: true,
          code: 'INSUFFICIENT_CREDITS',
        });
      }
      // result.alreadyProcessed = credit was already deducted on a prior identical request → serve clean
    }

    if (exportType === 'cover_letter') {
      // Export cover letter
      const coverLetterText = scan.cover_letter_text || '';
      if (!coverLetterText) {
        return res.status(404).json({ error: 'No cover letter available for this scan.' });
      }

      if (format === 'pdf') {
        const parsed = parseCoverLetter(coverLetterText, buildCoverLetterContext(scan));
        const html = renderTemplate('cover-letter', parsed, {
          watermark: req.isWatermarked,
          density: resolvedDensity,
          template: resolvedTemplate,
        });
        const buffer = await renderHtmlToPdf(html);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="cover-letter${req.isWatermarked ? '-preview' : ''}.pdf"`
        );
        res.send(buffer);
      } else {
        const buffer = await generateDOCX(coverLetterText, {}, [], [], {
          isCoverLetter: true,
          template: resolvedTemplate,
          density: resolvedDensity,
        });
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="cover-letter${req.isWatermarked ? '-preview' : ''}.docx"`
        );
        res.send(buffer);
      }

      // Record watermarked download for audit
      if (req.isWatermarked && req.user) {
        await db.recordWatermarkedDownload(req.user.id, scanId, format, 'cover_letter');
      }
      return;
    }

    // Export resume
    if (format === 'pdf') {
      const { buffer, renderMeta } = await renderResumePdf(scan, {
        watermark: req.isWatermarked,
        template: preferredTemplate || undefined,
        density: preferredDensity || undefined,
      });
      await db.updateScan(scanId, {
        jobContext: resolveScanJobContext(scan),
        renderMeta,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="optimized-resume${req.isWatermarked ? '-preview' : ''}.pdf"`
      );
      res.send(buffer);
    } else {
      const buffer = await generateDOCX(resumeText, sectionData, optimizedBullets, keywordPlan, {
        template: resolvedTemplate,
        density: resolvedDensity,
      });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="optimized-resume${req.isWatermarked ? '-preview' : ''}.docx"`
      );
      res.send(buffer);
    }

    // Record watermarked download for audit
    if (req.isWatermarked && req.user) {
      await db.recordWatermarkedDownload(req.user.id, scanId, format, 'resume');
    }
  } catch (err) {
    const scanId = parseScanId(req.params.scanId);
    if (scanId && err.renderMeta) {
      try {
        await db.updateScan(scanId, { renderMeta: err.renderMeta });
      } catch {
        /* ignore render metadata persistence errors */
      }
    }
    log.error('Download error', { error: err.message, scanId: req.params.scanId });
    res.status(500).json({ error: 'Failed to generate resume file.' });
  }
});

module.exports = router;
