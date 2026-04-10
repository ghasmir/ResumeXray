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
const { processJobDescription } = require('../lib/jd-processor');
const { validateResumeContent } = require('../lib/resume-validator');
const { runAgentPipeline } = require('../lib/agent-pipeline');
const { generateDOCX, generatePDF, validatePDF, renderHtmlToPdf } = require('../lib/resume-builder');
const { parseCoverLetter } = require('../lib/cover-letter-parser');
const { renderTemplate } = require('../lib/template-renderer');
const db = require('../db/database');
const log = require('../lib/logger');

// §9.5: Track active SSE connections per user for concurrent stream limiting
const activeStreams = new Map(); // userId|ip → Set<res>

// In-process ATS profile cache: sessionId → atsProfile
// Lives only between POST /start and GET /stream (seconds). Auto-expires after 15min.
const atsProfileCache = new Map();

// Helper: parse and validate scanId from URL params
function parseScanId(raw) {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── Session + Upload Storage (Phase 3: DB Sessions + Disk Uploads) ────────────
// Resume buffers are written to disk (prevents OOM with concurrent uploads).
// Session data is persisted in SQLite scan_sessions table (survives restarts).

const UPLOAD_TMP = path.join(__dirname, '..', 'tmp_uploads');
if (!fs.existsSync(UPLOAD_TMP)) fs.mkdirSync(UPLOAD_TMP, { recursive: true });

// Periodic cleanup: purge expired sessions + stale temp files (every 2 min)
setInterval(async () => {
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
  } catch { /* ignore cleanup errors */ }
}, 2 * 60 * 1000);

// ── POST /agent/start — Upload + parse, return sessionId ──────────────────────

router.post('/start', agentLimiter, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please submit a resume file (PDF or DOCX).' });
    }

    // Security: Validate file magic bytes (prevents MIME spoofing)
    if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ 
        error: 'File integrity check failed. The file appears corrupted or is not a valid PDF/DOCX.' 
      });
    }

    const rawText = await parser.parseResume(req.file.buffer, req.file.mimetype);
    if (!rawText || rawText.trim() === '') {
      return res.status(400).json({ error: 'Could not extract text. Ensure it is not an image-based PDF.' });
    }

    // Content validation: reject non-resume files
    const validation = validateResumeContent(rawText);
    if (!validation.isResume) {
      return res.status(400).json({ error: `This doesn't appear to be a resume. Please upload your resume file (PDF or DOCX) containing your work experience, education, and skills.` });
    }

    // §10.11: Input length validation — prevent oversized payloads before LLM processing
    let jdText = '';
    let jobUrl = req.body.jobUrl || '';
    let jobTitle = '';
    let atsProfileTemp = null; // Populated if JD provided
    const jdInput = req.body.jobDescription || jobUrl || '';

    if (jobUrl && jobUrl.length > 2048) {
      return res.status(400).json({ error: 'Job URL is too long (max 2048 characters).' });
    }
    if (jdInput.length > 50000) {
      return res.status(400).json({ error: 'Job description is too long (max 50,000 characters).' });
    }

    if (jdInput.trim()) {
      try {
        const jdResult = await processJobDescription(jdInput, '', jobUrl);
        jdText = jdResult.jdText;
        jobUrl = jdResult.jobUrl || jobUrl;
        jobTitle = jdResult.jobTitle || '';
        atsProfileTemp = jdResult.atsProfile;
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }


    // Guest scan limit (2 free scans per IP per day)
    if (!req.user) {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const guestCount = await db.getGuestScanCount(ip);
      if (guestCount >= 2) {
        return res.status(429).json({ error: 'Free scan limit reached. Sign up to continue.', signup: true });
      }
    }

    // Determine credit balance for value wall decisions
    const creditBalance = req.user ? await db.getCreditBalance(req.user.id) : 0;

    const sessionId = uuidv4();

    // Cache atsProfile keyed by sessionId (in-process Map, lives seconds until /stream reads it)
    if (atsProfileTemp) {
      atsProfileCache.set(sessionId, atsProfileTemp);
      // Auto-expire after 15 minutes so the Map never leaks memory
      setTimeout(() => atsProfileCache.delete(sessionId), 15 * 60 * 1000);
    }

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
      jobUrl: sanitizeInput(jobUrl),
      jobTitle: sanitizeInput(jobTitle),
      companyName: sanitizeInput(req.body.companyName || ''),
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

    res.json({ success: true, sessionId, creditBalance });

  } catch (err) {
    log.error('Agent start error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to start analysis.' });
  }
});

// ── GET /agent/stream/:sessionId — SSE streaming pipeline ─────────────────────

router.get('/stream/:sessionId', async (req, res) => {
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
        sessionId: req.params.sessionId
      });
      return res.status(403).json({ error: 'Unauthorized stream access.' });
    }
  }

  // Map DB column names → camelCase for pipeline compatibility
  // Also read atsProfile from the in-process cache (stored during /start)
  const session = {
    resumeText: dbSession.resume_text,
    resumeFilePath: dbSession.resume_file_path,
    resumeMimetype: dbSession.resume_mimetype,
    fileName: dbSession.file_name,
    jdText: dbSession.jd_text,
    jobUrl: dbSession.job_url,
    jobTitle: dbSession.job_title,
    companyName: dbSession.company_name,
    userId: dbSession.user_id,
    creditBalance: dbSession.credit_balance,
    atsProfile: atsProfileCache.get(req.params.sessionId) || null,
  };
  // Clean up cache entry now that stream has consumed it
  atsProfileCache.delete(req.params.sessionId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // §9.5: Enforce max 2 concurrent SSE streams per user
  const streamKey = session.userId ? `u:${session.userId}` : `ip:${req.ip}`;
  if (!activeStreams.has(streamKey)) activeStreams.set(streamKey, new Set());
  const userStreams = activeStreams.get(streamKey);
  if (userStreams.size >= 2) {
    log.warn('SSE concurrent limit exceeded', { streamKey, active: userStreams.size });
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Too many active scans. Close other tabs and retry.' })}\n\n`);
    return res.end();
  }
  userStreams.add(res);

  // §9.2: Heartbeat — send `: ping` every 15s to keep Cloudflare/proxies alive
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  // §9.7: Max SSE lifetime — force-close after 5 minutes
  const maxLifetime = setTimeout(() => {
    if (!res.writableEnded) {
      log.warn('SSE max lifetime exceeded, force-closing', { streamKey });
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Stream timeout. Please retry.' })}\n\n`);
      res.end();
    }
  }, 5 * 60 * 1000);

  res.write(':\n\n');

  // v3: AI Sandbox is FREE — no bullet rewrite limits
  // All bullet rewrites run without credit deduction
  // Credits are only consumed when user exports final PDF/DOCX
  const maxBulletRewrites = 10; // Max rewrites per scan

  // §9.3: Backpressure-aware write — prevents unbounded buffer growth
  // §9.4: Event IDs for Last-Event-ID reconnection
  let eventId = 0;
  function sseWrite(event, data) {
    if (res.writableEnded) return;
    eventId++;
    const msg = `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const ok = res.write(msg);
    // If the kernel buffer is full, Node returns false — we should pause upstream
    // The LLM streaming will naturally pause when the event loop is blocked
    if (!ok && !res.writableEnded) {
      // Wait for drain before continuing (backpressure signal)
      return new Promise(resolve => res.once('drain', resolve));
    }
  }

  const emitter = {
    emitStep(step, name, status, label, data = null) {
      const payload = { step, name, status, label };
      if (data) payload.data = data;
      sseWrite('step', payload);
    },
    emitToken(step, name, chunk, bulletIndex) {
      const payload = { step, name, chunk };
      if (bulletIndex !== undefined) payload.bulletIndex = bulletIndex;
      sseWrite('token', payload);
    },
    emitBullet(step, index, status, original, rewritten, method, targetKeyword) {
      const payload = { step, index, status, original };
      if (rewritten) payload.rewritten = rewritten;
      if (method) payload.method = method;
      if (targetKeyword) payload.targetKeyword = targetKeyword;
      sseWrite('bullet', payload);
    },
    emitScores(scores) {
      sseWrite('scores', scores);
    },
    emitInit(scanId) {
      sseWrite('init', { scanId });
    },
    async emitComplete(scanId) {
      const creditBalance = session.userId ? await db.getCreditBalance(session.userId) : 0;
      const canDownloadClean = creditBalance >= 1;
      sseWrite('complete', {
        scanId,
        canDownloadClean,
        downloadUrl: `/api/agent/download/${scanId}`,
        creditBalance,
        isWatermarked: !canDownloadClean,
        resumeText: session.resumeText,
        hasCoverLetter: true,
        accessToken: accessToken || null  // For guest scan preview URLs (IDOR protection)
      });
    },
    emitError(message, step) {
      sseWrite('error', { message, step });
    },
    emitCoverLetter(text) {
      sseWrite('coverLetter', { text });
    },
    emitAtsProfile(atsProfile) {
      sseWrite('atsProfile', {
        name: atsProfile.name,
        displayName: atsProfile.displayName,
        template: atsProfile.template,
      });
    }
  };

  let aborted = false;
  req.on('close', () => { aborted = true; });
  // §HIGH: Clean up SSE tracking if client disconnects (crash, network drop, tab close).
  // Without this, activeStreams leaks entries when the finally block hasn't run yet.
  res.on('close', () => {
    aborted = true;
    clearInterval(heartbeat);
    clearTimeout(maxLifetime);
    userStreams.delete(res);
    if (userStreams.size === 0) activeStreams.delete(streamKey);
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
      parsedData: {} 
    });
  }

  const scanResult = await db.saveScan(session.userId, {
    resumeId,
    jobDescription: session.jdText,
    jobUrl: session.jobUrl,
    jobTitle: session.jobTitle,
    companyName: session.companyName,
    parseRate: 0,
    formatHealth: 0,
    matchRate: 0,
    xrayData: {},
    formatIssues: [],
    keywordData: {},
    sectionData: {},
    recommendations: [],
    aiSuggestions: null
  });

  const scanId = scanResult.scanId;
  const accessToken = scanResult.accessToken;

  // Phase 6 §3.1-A: Store guest scan access token in session for IDOR-safe claiming.
  // When this guest later signs up, only scans with tokens in their session will be claimed.
  if (!session.userId && accessToken && req.session) {
    if (!req.session.guestScanTokens) req.session.guestScanTokens = [];
    req.session.guestScanTokens.push(accessToken);
    req.session.save(); // Persist immediately — SSE is long-lived
  }

  log.info('Scan created', { scanId, userId: session.userId });

  // Let the frontend know our persistent ID
  emitter.emitInit(scanId);

  try {
    const results = await runAgentPipeline(
      session.resumeText,
      session.jdText,
      emitter,
      { maxBulletRewrites, limitKeywords: 5, atsProfile: session.atsProfile }
    );

    if (aborted) return;

    // Update database with final results
    if (session.userId && resumeId) {
       // Optional: update parsedData in resume record if needed
    }

    await db.updateScan(scanId, {
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
        aiShieldData: results.aiShieldData
      }
    });

    await db.updateScanWithOptimizations(scanId, {
      optimizedBullets: results.optimizedBullets,
      keywordPlan: results.keywordPlan,
      optimizedResumeText: results.optimizedResumeText,
      coverLetterText: results.coverLetter || null,
      atsPlatform: results.atsProfile?.name || null
    });

    // v3: No credit deduction for AI rewrites — they're free (sandbox mode)
    // Credits are only deducted on final export in the download route
    // Still track scan usage
    if (session.userId) {
      await db.incrementScanCount(session.userId);
    } else {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
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
      try { fs.unlinkSync(session.resumeFilePath); } catch { /* already cleaned */ }
    }
    // §9: Clean up SSE tracking
    clearInterval(heartbeat);
    clearTimeout(maxLifetime);
    userStreams.delete(res);
    if (userStreams.size === 0) activeStreams.delete(streamKey);
    res.end();
  }
});

// ── GET /agent/preview/:scanId — Inline PDF Preview ────────────

router.get('/preview/:scanId', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const scanId = parseScanId(req.params.scanId);
    if (!scanId) return res.status(400).json({ error: 'Invalid scan ID.' });
    const scan = await db.getFullScan(scanId, userId);
    if (!scan) return res.status(404).json({ error: 'Scan not found.' });

    // SECURITY: Guest scans require a valid access token (prevents IDOR)
    if (!userId && scan.access_token) {
      const providedToken = req.query.token;
      if (scan.access_token !== providedToken) {
        return res.setHeader('Content-Type', 'text/html; charset=utf-8').send(`
          <!DOCTYPE html>
          <html><head><style>
            body { margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,sans-serif; background:#f8f9fa; color:#333; }
            .paywall { text-align:center; padding:3rem; max-width:400px; }
            .paywall svg { margin-bottom:1.5rem; opacity:0.3; }
            .paywall h3 { font-size:1.2rem; margin-bottom:0.75rem; }
            .paywall p { color:#666; font-size:0.9rem; line-height:1.6; }
          </style></head><body>
            <div class="paywall">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              <h3>Premium Content</h3>
              <p>Sign in or create an account to view your ATS-optimized resume. Export requires 1 credit.</p>
            </div>
          </body></html>
        `);
      }
    }

    const resumeText = scan.optimized_resume_text || '';
    const sectionData = scan.section_data || {};
    const optimizedBullets = scan.optimized_bullets || [];
    const keywordPlan = scan.keyword_plan || [];

    const density = req.query.density || 'standard';
    const VALID_TEMPLATES = ['modern', 'classic', 'minimal'];
    const template = VALID_TEMPLATES.includes(req.query.template) ? req.query.template : 'modern';

    // Always enforce watermark for the free preview
    const buffer = await generatePDF(resumeText, sectionData, optimizedBullets, keywordPlan, {
      watermark: true,
      density,
      template,
      jobUrl: scan.job_url || ''
    });

    res.setHeader('Content-Type', 'application/pdf');
    // 'inline' tells the browser to display it in the iframe instead of downloading
    res.setHeader('Content-Disposition', `inline; filename="optimized-preview.pdf"`);
    res.send(buffer);
  } catch (err) {
    log.error('Preview error', { error: err.message, stack: err.stack, scanId: req.params.scanId });
    
    // Fallback: render an HTML preview instead of failing completely
    try {
      const scan = await db.getFullScan(parseScanId(req.params.scanId), req.user ? req.user.id : null);
      if (scan) {
        const resumeText = scan.optimized_resume_text || scan.resume_text || '';
        const { renderTemplate } = require('../lib/template-renderer');
        const { buildResumeData } = require('../lib/resume-builder');
        const data = buildResumeData(resumeText, scan.section_data || {}, scan.optimized_bullets || [], scan.keyword_plan || []);
        const html = renderTemplate('modern', data, { watermark: true, density: 'standard', jobUrl: scan.job_url || '' });
        return res.setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
      }
    } catch (fallbackErr) {
      log.error('HTML fallback also failed', { error: fallbackErr.message });
    }
    
    res.status(500).send(`
      <!DOCTYPE html><html><head><style>
        body { margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh; font-family:-apple-system,sans-serif; background:#f8f9fa; }
        .msg { text-align:center; padding:2rem; max-width:400px; }
        .msg h3 { margin-bottom:0.75rem; }
        .msg p { color:#666; font-size:0.9rem; line-height:1.6; }
      </style></head><body>
        <div class="msg">
          <h3>PDF Preview Temporarily Unavailable</h3>
          <p>The PDF rendering engine is starting up. Please try refreshing in a few seconds, or download the DOCX version instead.</p>
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
    if (!scanId) return res.status(400).send('Invalid scan ID.');
    const scan = await db.getFullScan(scanId, userId);
    if (!scan) return res.status(404).send('Scan not found.');

    // SECURITY: Guest scans require a valid access token (prevents IDOR)
    if (!userId && scan.access_token) {
      const providedToken = req.query.token;
      if (scan.access_token !== providedToken) {
        return res.setHeader('Content-Type', 'text/html; charset=utf-8').send(`
          <!DOCTYPE html>
          <html><head><style>
            body { margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,sans-serif; background:#fff; color:#333; }
            .paywall { text-align:center; padding:3rem; max-width:400px; }
            .paywall svg { margin-bottom:1.5rem; opacity:0.3; }
            .paywall h3 { font-size:1.2rem; margin-bottom:0.75rem; }
            .paywall p { color:#666; font-size:0.9rem; line-height:1.6; }
          </style></head><body>
            <div class="paywall">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,4 12,13 2,4"/></svg>
              <h3>AI Cover Letter Preview</h3>
              <p>Sign in to preview your personalized cover letter. Export as PDF or DOCX requires 1 credit.</p>
            </div>
          </body></html>
        `);
      }
    }

    // Build context for cover letter — try multiple sources for name/contact
    let clName = scan.section_data?.name || '';
    let clContact = scan.section_data?.contact || '';
    
    // Fallback: try xray extracted fields if section_data is missing them
    if (!clName && scan.xray_data?.extractedFields?.Name) {
      clName = scan.xray_data.extractedFields.Name;
    }
    if (!clContact) {
      const ef = scan.xray_data?.extractedFields || {};
      const parts = [ef.Email, ef.Phone].filter(Boolean);
      if (parts.length) clContact = parts.join(' | ');
    }

    const ctx = {
      name: clName,
      contact: clContact,
      jobTitle: scan.job_title,
      companyName: scan.company_name
    };

    const parsed = parseCoverLetter(scan.cover_letter_text || '', ctx);
    const html = renderTemplate('cover-letter', parsed, { watermark: false, density: 'standard' });

    // ── REVENUE PROTECTION ──────────────────────────────────────────────
    // Logged-in users: light watermark only (good preview experience)
    // Guests: full blur + watermark + anti-copy (prevents free usage)
    const isLoggedIn = !!userId;
    
    let protectionCss = '';
    let protectionJs = '';

    if (isLoggedIn) {
      // Light watermark + anti-copy (no blur)
      protectionCss = `
        html, body {
          overflow: hidden !important;
          width: 100vw;
          max-width: 100%;
          box-sizing: border-box;
          user-select: none !important;
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
        }
        body::after {
          content: 'ResumeXray Preview';
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-35deg);
          font-size: 3.5rem;
          font-weight: 900;
          color: rgba(180, 180, 180, 0.08);
          pointer-events: none;
          z-index: 9999;
          white-space: nowrap;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
      `;
      protectionJs = `<script>document.addEventListener('contextmenu', function(e) { e.preventDefault(); });</script>`;
    } else {
      // Full guest protection: blur + watermark + anti-copy
      protectionCss = `
        html, body {
          overflow: hidden !important;
          width: 100vw;
          max-width: 100%;
          box-sizing: border-box;
        }
        body::after {
          content: 'ResumeXray';
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-35deg);
          font-size: 4.5rem;
          font-weight: 900;
          color: rgba(120, 120, 120, 0.13);
          pointer-events: none;
          z-index: 9999;
          white-space: nowrap;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          user-select: none;
          -webkit-user-select: none;
        }
        body::before {
          content: '';
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 60%;
          background: linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 20%, rgba(255,255,255,0.95) 100%);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 9998;
          pointer-events: none;
        }
        body {
          user-select: none !important;
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
        }
      `;
      protectionJs = `<script>document.addEventListener('contextmenu', function(e) { e.preventDefault(); });</script>`;
    }

    const protectedHtml = html.replace('</head>', `
      <style>${protectionCss}</style>
      ${protectionJs}
    </head>`);

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
    if (!scanId) return res.status(400).json({ error: 'Invalid scan ID.' });
    const scan = await db.getFullScan(scanId, userId);
    if (!scan) return res.status(404).json({ error: 'Scan not found.' });

    const format = req.query.format || 'docx';
    const exportType = req.query.type || 'resume'; // 'resume' or 'cover_letter'
    const resumeText = scan.optimized_resume_text || '';
    const sectionData = scan.section_data || {};
    const optimizedBullets = scan.optimized_bullets || [];
    const keywordPlan = scan.keyword_plan || [];

    // Atomic credit deduction with idempotency key (prevents double-deduction)
    if (req.user && !req.isWatermarked) {
      const idempotencyKey = `export-${req.params.scanId}-${format}-${exportType}`;
      const result = await db.deductCreditAtomic(req.user.id, 'export', idempotencyKey, `Exported ${format.toUpperCase()} ${exportType}`);
      
      if (!result.success && !result.alreadyProcessed) {
        // Insufficient credits — fall back to watermarked
        req.isWatermarked = true;
      }
      // If alreadyProcessed, credit was already deducted — serve clean version
    }

    const density = req.query.density || 'standard';
    const VALID_TEMPLATES = ['modern', 'classic', 'minimal'];
    const template = VALID_TEMPLATES.includes(req.query.template) ? req.query.template : 'modern';

    if (exportType === 'cover_letter') {
      // Export cover letter
      const coverLetterText = scan.cover_letter_text || '';
      if (!coverLetterText) {
        return res.status(404).json({ error: 'No cover letter available for this scan.' });
      }

      if (format === 'pdf') {
        // Same fallback logic as preview route
        let clName = sectionData?.name || '';
        let clContact = sectionData?.contact || '';
        if (!clName && scan.xray_data?.extractedFields?.Name) {
          clName = scan.xray_data.extractedFields.Name;
        }
        if (!clContact) {
          const ef = scan.xray_data?.extractedFields || {};
          const parts = [ef.Email, ef.Phone].filter(Boolean);
          if (parts.length) clContact = parts.join(' | ');
        }
        const ctx = {
          name: clName,
          contact: clContact,
          jobTitle: scan.job_title,
          companyName: scan.company_name
        };
        const parsed = parseCoverLetter(coverLetterText, ctx);
        const html = renderTemplate('cover-letter', parsed, { watermark: req.isWatermarked, density: 'standard' });
        const buffer = await renderHtmlToPdf(html);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="cover-letter${req.isWatermarked ? '-preview' : ''}.pdf"`);
        res.send(buffer);
      } else {
        const buffer = await generateDOCX(coverLetterText, {}, [], [], { isCoverLetter: true });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="cover-letter${req.isWatermarked ? '-preview' : ''}.docx"`);
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
      const buffer = await generatePDF(resumeText, sectionData, optimizedBullets, keywordPlan, {
        watermark: req.isWatermarked,
        density,
        template,
        jobUrl: scan.job_url || ''
      });

      // Self-test: validate the generated PDF has a readable text layer
      if (!req.isWatermarked) {
        const validation = await validatePDF(buffer, resumeText.split('\n')[0] || '');
        if (!validation.valid) {
          log.warn('PDF validation warning', { error: validation.error });
        }
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="optimized-resume${req.isWatermarked ? '-preview' : ''}.pdf"`);
      res.send(buffer);
    } else {
      const buffer = await generateDOCX(resumeText, sectionData, optimizedBullets, keywordPlan);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="optimized-resume${req.isWatermarked ? '-preview' : ''}.docx"`);
      res.send(buffer);
    }

    // Record watermarked download for audit 
    if (req.isWatermarked && req.user) {
      await db.recordWatermarkedDownload(req.user.id, scanId, format, 'resume');
    }
  } catch (err) {
    log.error('Download error', { error: err.message, scanId: req.params.scanId });
    res.status(500).json({ error: 'Failed to generate resume file.' });
  }
});

module.exports = router;
