/**
 * Usage Middleware — Credit-Based Limits (v3)
 * 
 * Credit Economy v3:
 *   - Scans are FREE (hooks the user with ATS score + knockout risks)
 *   - AI bullet rewrites are FREE (sandbox — show full value before paying)
 *   - PDF/DOCX export costs 1 credit (the only credit gate)
 *   - Cover letter generation is included with export (same 1 credit)
 *   - Guests get 2 free scans (IP-limited), no exports
 */

const { getCreditBalance, deductCredit, getGuestScanCount } = require('../db/database');

/**
 * Check scan limit — scans are free for logged-in users, IP-limited for guests.
 */
async function checkScanLimit(req, res, next) {
  if (!req.user) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const count = await getGuestScanCount(ip);
    
    if (count >= 2) {
      return res.status(429).json({
        error: "You've used your 2 free scans. Create a free account to continue scanning!",
        signup: true
      });
    }
    return next();
  }

  // Logged-in users: scans are always free (no credit deduction for scanning)
  next();
}

/**
 * AI features are now FREE (sandbox mode).
 * No credit check needed — users can optimize bullets freely.
 * Credits are only consumed on final export.
 */
async function checkAiCredit(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Please log in to use AI features.' });
  }
  // v3: AI sandbox is free — no credit check
  req.creditBalance = await getCreditBalance(req.user.id);
  next();
}

/**
 * Check if user has credits for export (PDF/DOCX download).
 * This is the ONLY credit gate in v3.
 *
 * CRITICAL ARCHITECTURE NOTE:
 * This middleware does NOT make the final watermark decision based on balance.
 * The actual balance check happens INSIDE the atomic transaction in the route
 * handler (deductCreditAtomic). This prevents the TOCTOU race condition where
 * two simultaneous requests both read balance=1, both set isWatermarked=false,
 * and both deduct — resulting in a negative balance.
 *
 * Flow:
 *   1. Middleware: Sets req.isWatermarked = false (tentative)
 *   2. Route handler: deductCreditAtomic checks balance inside transaction
 *   3. If deduction fails: route overrides req.isWatermarked = true
 */
async function checkExportCredit(req, res, next) {
  if (!req.user) {
    // Guests can download — but with watermark (handled in the route)
    req.isWatermarked = true;
    return next();
  }

  // Tentative — the atomic deduction in the route handler makes the real decision.
  // We pass balance for UI display purposes only (e.g., showing remaining credits).
  req.creditBalance = await getCreditBalance(req.user.id);
  req.isWatermarked = false;
  next();
}

/**
 * Legacy compatibility: resume save limit (no limit in credit system).
 */
function checkResumeLimit(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to save resumes.' });
  next(); // No resume limit in credit system
}

module.exports = { checkScanLimit, checkAiCredit, checkExportCredit, checkResumeLimit };
