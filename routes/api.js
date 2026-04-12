const express = require('express');
const router = express.Router();
const { upload, validateMagicBytes } = require('../middleware/upload');
const { apiLimiter, sanitizeInput } = require('../config/security');
const { checkScanLimit } = require('../middleware/usage');
const { analyzeResume } = require('../lib/analyzer');
const parser = require('../lib/parser');
const { processJobDescription } = require('../lib/jd-processor');
const { validateResumeContent } = require('../lib/resume-validator');
const db = require('../db/database');
const log = require('../lib/logger');

/**
 * Perform ATS Analysis (Upload Resume + Optional JD)
 * Scans are FREE — no credit deduction for scanning.
 */
router.post('/analyze', apiLimiter, upload.single('resume'), checkScanLimit, async (req, res) => {
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
      return res.status(400).json({ error: 'Could not extract text from the file. Ensure it is not an image-based PDF.' });
    }

    // Content validation: reject non-resume files
    const resumeCheck = validateResumeContent(rawText);
    if (!resumeCheck.isResume) {
      return res.status(400).json({ error: `This doesn't appear to be a resume. Please upload your resume file (PDF or DOCX) containing your work experience, education, and skills.` });
    }

    // Smart JD handling — Security: sanitize all user-text inputs
    let jdText = '';
    let jobTitle = sanitizeInput(req.body.jobTitle || '');
    let companyName = sanitizeInput(req.body.companyName || '');
    let jobUrl = sanitizeInput(req.body.jobUrl || '');
    let jdScrapeFailed = false;

    const jdInput = sanitizeInput(req.body.jobDescription || '') || jobUrl || '';
    if (jdInput.trim()) {
      try {
        const jdResult = await processJobDescription(jdInput, jobTitle, jobUrl);
        jdText = jdResult.jdText;
        jobUrl = jdResult.jobUrl || jobUrl;
        jobTitle = jdResult.jobTitle || jobTitle;
      } catch (err) {
        log.warn('JD extraction failed', { error: err.message });
        jdScrapeFailed = true;
      }
    }

    const analysis = await analyzeResume(rawText, jdText);

    let resumeId = null;

    if (req.user) {
      resumeId = await db.saveResume(req.user.id, {
        name: req.file.originalname,
        fileName: req.file.originalname,
        fileType: req.file.mimetype === 'application/pdf' ? 'pdf' : 'docx',
        fileSize: req.file.size,
        rawText: rawText,
        parsedData: analysis.sectionData
      });
    }

    const scanResult = await db.saveScan(req.user ? req.user.id : null, {
      resumeId,
      jobDescription: jdText,
      jobUrl,
      jobTitle,
      companyName,
      parseRate: analysis.parseRate,
      formatHealth: analysis.formatHealth,
      matchRate: analysis.matchRate,
      xrayData: analysis.xrayData,
      formatIssues: analysis.formatIssues,
      keywordData: analysis.keywordData,
      sectionData: analysis.sectionData,
      recommendations: analysis.recommendations,
      aiSuggestions: {
        biasShield: analysis.biasShield,
        aiShieldData: analysis.aiShieldData
      }
    });

    const scanId = scanResult.scanId;
    const accessToken = scanResult.accessToken;

    if (req.user) {
      await db.incrementScanCount(req.user.id);
    } else {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      await db.recordGuestScan(ip);
    }

    // Include credit balance in response for logged-in users
    const creditBalance = req.user ? await db.getCreditBalance(req.user.id) : 0;

    res.json({
      success: true,
      scanId,
      accessToken: accessToken || undefined,  // Only present for guest scans
      results: analysis,
      creditBalance,
      warning: jdScrapeFailed ? 'Could not scrape the job URL — analysis was run without a job description.' : undefined
    });

  } catch (err) {
    log.error('Analysis error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'An error occurred during analysis.' });
  }
});

// Retrieve a specific scan from history
router.get('/scan/:id', async (req, res) => {
  try {
    const scanId = req.params.id;
    const userId = req.user ? req.user.id : null;
    const accessToken = typeof req.query.token === 'string' ? req.query.token : null;
    
    log.debug('Scan fetch request', { scanId, userId, email: req.user?.email || 'guest' });
    const scan = await db.getScan(scanId, userId, accessToken);
    log.debug('Scan fetch result', { scanId, found: !!scan });
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    
    if (scan.user_id !== null && (!req.user || req.user.id !== scan.user_id)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const parsedAi = JSON.parse(scan.ai_suggestions || '{}') || {};

    const analysis = {
      id: scan.id,
      parseRate: scan.parse_rate,
      formatHealth: scan.format_health,
      matchRate: scan.match_rate,
      xrayData: JSON.parse(scan.xray_data || '{}') || {},
      formatIssues: JSON.parse(scan.format_issues || '[]') || [],
      keywordData: JSON.parse(scan.keyword_data || 'null'),
      sectionData: JSON.parse(scan.section_data || '{}') || {},
      recommendations: JSON.parse(scan.recommendations || '[]') || [],
      biasShield: (parsedAi && parsedAi.biasShield) || { riskScore: 0, flags: [] },
      aiShieldData: (parsedAi && parsedAi.aiShieldData) || { ghostingBullets: [], knockoutRisks: [] },
      // Agent (Premium) fields — strictly camelCase for frontend detection
      optimizedResumeText: scan.optimized_resume_text || null,
      optimizedBullets: scan.optimized_bullets ? JSON.parse(scan.optimized_bullets) : null,
      keywordPlan: scan.keyword_plan ? JSON.parse(scan.keyword_plan) : null,
      coverLetterText: scan.cover_letter_text || null,
    };
    res.json({ success: true, results: analysis });
  } catch(e) {
    log.error('Fetch scan error', { error: e.message, scanId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch scan' });
  }
});

// AI Bullet Fixer — FREE (sandbox mode, v3)
router.post('/fix-bullet', apiLimiter, async (req, res) => {
  const { bulletText, jobDescription } = req.body;
  if (!bulletText) return res.status(400).json({ error: 'Bullet text is required.' });

  // Security: Sanitize text inputs
  const safeBulletText = sanitizeInput(bulletText);
  const safeJobDescription = sanitizeInput(jobDescription || '');

  if (!req.user) {
    // Allow 3 free fixes for guests (encourage signup)
    if (!req.session.freeFixes) req.session.freeFixes = 0;
    if (req.session.freeFixes >= 3) {
      return res.status(403).json({ error: 'Sign up for unlimited free AI bullet rewrites!', signup: true });
    }
    req.session.freeFixes++;
  }

  try {
    const { rewriteBulletWithCAR } = require('../lib/llm/llm-service');
    const result = await rewriteBulletWithCAR(safeBulletText, safeJobDescription);
    
    // v3: No credit deduction — AI sandbox is free
    const creditBalance = req.user ? await db.getCreditBalance(req.user.id) : 0;
    res.json({ success: true, ...result, creditBalance });
  } catch (err) {
    log.error('Bullet fix error', { error: err.message });
    res.status(500).json({ error: 'Failed to optimize bullet. Please try again.' });
  }
});

module.exports = router;
