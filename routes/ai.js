/**
 * AI Routes — v5.0 (Free Sandbox Mode)
 * 
 * ALL AI features are FREE — no credit deduction for any AI operation.
 * Credits are ONLY consumed on final PDF/DOCX/Cover Letter EXPORT.
 * This is the core v3+ design: hook users with free value, charge on export.
 */

const express = require('express');
const router = express.Router();
const { aiLimiter } = require('../config/security');
const llm = require('../lib/llm/llm-service');
const db = require('../db/database');
const log = require('../lib/logger');

// Protect all AI routes with rate limiting
router.use(aiLimiter);

// POST /ai/rewrite-bullet — FREE (sandbox mode)
router.post('/rewrite-bullet', async (req, res) => {
  try {
    if (!req.user) {
      // Allow 3 free fixes for guests
      if (!req.session.freeAiRewrites) req.session.freeAiRewrites = 0;
      if (req.session.freeAiRewrites >= 3) {
        return res.status(403).json({ error: 'Sign up for unlimited free AI bullet rewrites!', signup: true });
      }
      req.session.freeAiRewrites++;
    }

    const { originalText, jobDescription } = req.body;
    if (!originalText) return res.status(400).json({ error: 'Missing originalText' });

    const rewritten = await llm.rewriteBulletPoint(originalText, jobDescription);
    
    // v5: NO credit deduction — AI sandbox is free
    const creditBalance = req.user ? await db.getCreditBalance(req.user.id) : 0;
    res.json({ success: true, rewritten, creditBalance });
  } catch (err) {
    log.error('AI rewrite error', { error: err.message });
    res.status(500).json({ error: 'Failed to rewrite bullet point. Please try again.' });
  }
});

// POST /ai/cover-letter — FREE generation, export costs 1 credit
router.post('/cover-letter', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Please sign up to generate cover letters.', signup: true });
    }

    const { resumeId, jobDescription } = req.body;
    if (!resumeId || !jobDescription) {
      return res.status(400).json({ error: 'Missing resumeId or jobDescription' });
    }

    const resume = await db.getResume(parseInt(resumeId), req.user.id);
    if (!resume) return res.status(404).json({ error: 'Resume not found' });

    const coverLetterText = await llm.generateCoverLetter(resume.raw_text, jobDescription);

    await db.saveCoverLetter(req.user.id, {
      title: 'Generated Cover Letter',
      content: coverLetterText
    });

    // v5: NO credit deduction for generation — only export costs credits
    const creditBalance = await db.getCreditBalance(req.user.id);
    res.json({ success: true, coverLetter: coverLetterText, creditBalance });
  } catch (err) {
    log.error('AI cover letter error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate cover letter.' });
  }
});

// POST /ai/interview-prep — FREE
router.post('/interview-prep', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Please sign up for interview prep.', signup: true });
    }

    const { resumeId, jobDescription } = req.body;
    if (!resumeId || !jobDescription) {
      return res.status(400).json({ error: 'Missing resumeId or jobDescription' });
    }

    const resume = await db.getResume(parseInt(resumeId), req.user.id);
    if (!resume) return res.status(404).json({ error: 'Resume not found' });

    const questions = await llm.generateInterviewPrep(resume.raw_text, jobDescription);

    // v5: NO credit deduction
    const creditBalance = await db.getCreditBalance(req.user.id);
    res.json({ success: true, questions, creditBalance });
  } catch (err) {
    log.error('AI interview prep error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate interview questions.' });
  }
});

// POST /ai/linkedin — FREE
router.post('/linkedin', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Please sign up for LinkedIn optimization.', signup: true });
    }

    const { resumeId, linkedinText } = req.body;
    if (!resumeId || !linkedinText) {
      return res.status(400).json({ error: 'Missing resumeId or linkedinText' });
    }

    const resume = await db.getResume(parseInt(resumeId), req.user.id);
    if (!resume) return res.status(404).json({ error: 'Resume not found' });

    const suggestions = await llm.optimizeLinkedIn(resume.raw_text, linkedinText);

    // v5: NO credit deduction
    const creditBalance = await db.getCreditBalance(req.user.id);
    res.json({ success: true, suggestions, creditBalance });
  } catch (err) {
    log.error('AI LinkedIn error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate LinkedIn suggestions.' });
  }
});

module.exports = router;
