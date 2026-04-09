const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db/database');
const mailer = require('../lib/mailer');
const { authLimiter } = require('../config/security');
const log = require('../lib/logger');

const router = express.Router();

// §10.12: Account lockout — 10 failed logins in 15 min = 30 min lockout
// Dual counters: IP-scoped AND email-scoped (prevents distributed + targeted attacks)
const loginAttempts = new Map(); // key → { count, firstAttempt, lockedUntil }
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_WINDOW = 15 * 60 * 1000;  // 15 min
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 min

function checkLockout(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  // Reset if lockout expired or window passed
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginAttempts.delete(key);
    return false;
  }
  if (Date.now() - entry.firstAttempt > LOCKOUT_WINDOW) {
    loginAttempts.delete(key);
    return false;
  }
  return false;
}

function recordFailedLogin(key) {
  const entry = loginAttempts.get(key) || { count: 0, firstAttempt: Date.now(), lockedUntil: null };
  entry.count++;
  if (entry.count >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION;
    log.warn('Account locked due to failed login attempts', { key, count: entry.count });
  }
  loginAttempts.set(key, entry);
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

// Clean up stale entries every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (entry.lockedUntil && now >= entry.lockedUntil) loginAttempts.delete(key);
    else if (now - entry.firstAttempt > LOCKOUT_WINDOW) loginAttempts.delete(key);
  }
}, 10 * 60 * 1000);

// ── Email/Password Signup ──────────────────────────────────────
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    // §10.14: Email format validation (RFC 5322 simplified)
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    // §10.14: Name length guard
    if (name.length > 100) {
      return res.status(400).json({ error: 'Name must be 100 characters or fewer.' });
    }
    // §10.13: NIST 800-63B minimum 8 chars + at least one digit
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (!/\d/.test(password)) {
      return res.status(400).json({ error: 'Password must contain at least one number.' });
    }

    // Check if user already exists
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    // Hash password and create user
    const hashed = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    const newUserId = await db.createUser({
      email, name, passwordHash: hashed, verificationToken
    });

    const user = await db.getUserById(newUserId);

    // Send verification email in background
    mailer.sendVerificationEmail(email, verificationToken).catch(err => {
      log.error('Failed to send verification email during signup', { error: err.message });
    });

    // Auto-login after signup with session regeneration
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ error: 'Account created but login failed.' });
      req.login(user, async (err) => {
        if (err) return res.status(500).json({ error: 'Account created but login failed.' });
        req.session._createdAt = Date.now(); // Set absolute timeout anchor

        // Phase 6 §3.1-A: Claim only THIS session's guest scans (IDOR fix)
        // Old code claimed ALL orphan scans globally — a signup would steal everyone's guest scans.
        // Now we scope the claim to access tokens tracked in this browser session.
        try {
          const guestTokens = req.session.guestScanTokens || [];
          if (guestTokens.length > 0) {
            const claimResult = await db.claimGuestScans(user.id, guestTokens);
            if (claimResult > 0) {
              log.info('Claimed guest scans for new user', { userId: user.id, claimed: claimResult });
            }
            // Clear tokens after claiming — prevent replay
            delete req.session.guestScanTokens;
            delete req.session.guestSessionIds;
          }
        } catch (claimErr) {
          log.warn('Failed to claim guest scans', { error: claimErr.message });
        }

        res.json({ 
          success: true, 
          user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
          message: 'Account created. Please check your email to verify your account.'
        });
      });
    });
  } catch (err) {
    log.error('Signup error', { error: err.message });
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

// ── Email/Password Login ───────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // §10.12: Check lockout (IP + email dual counters)
    const ipKey = `ip:${req.ip}`;
    const emailKey = `email:${email.toLowerCase()}`;
    if (checkLockout(ipKey) || checkLockout(emailKey)) {
      return res.status(429).json({
        error: 'Account temporarily locked due to too many failed attempts. Please try again in 30 minutes.'
      });
    }

    const user = await db.getUserByEmail(email);
    if (!user || !user.password_hash) {
      recordFailedLogin(ipKey);
      recordFailedLogin(emailKey);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      recordFailedLogin(ipKey);
      recordFailedLogin(emailKey);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // §10.12: Clear lockout counters on successful login
    clearLoginAttempts(ipKey);
    clearLoginAttempts(emailKey);

    // Session fixation prevention: regenerate session ID on login
    req.session.regenerate((err) => {
      if (err) {
        log.error('Session regeneration error', { error: err.message });
        return res.status(500).json({ error: 'Login failed.' });
      }

      req.login(user, (err) => {
        if (err) return res.status(500).json({ error: 'Login failed.' });
        req.session._createdAt = Date.now(); // Set absolute timeout anchor
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
      });
    });
  } catch (err) {
    log.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Phase 6 §7.7: Shared OAuth callback handler — detects requiresLinking
// §7.6: Session regeneration to prevent session fixation on OAuth login
function oauthCallbackHandler(req, res) {
  if (req.user && req.user.requiresLinking) {
    // Store pending link info in session and redirect to password verification
    req.session.pendingLink = {
      userId: req.user.id,
      provider: req.user.pendingProvider,
      profileId: req.user.pendingProfileId,
      avatarUrl: req.user.pendingAvatarUrl,
      email: req.user.email
    };
    // Logout the partially-authenticated user — they need to verify password first
    req.logout(() => {
      res.redirect('/login?linkRequired=true');
    });
    return;
  }

  // §7.6: Regenerate session ID after successful OAuth login (session fixation prevention)
  const user = req.user;
  const guestTokens = req.session?.guestScanTokens || [];
  const guestSessionIds = req.session?.guestSessionIds || [];
  req.session.regenerate((err) => {
    if (err) {
      log.error('OAuth session regeneration failed', { error: err.message });
      return res.redirect('/dashboard');
    }
    req.login(user, (loginErr) => {
      if (loginErr) {
        log.error('OAuth re-login after regeneration failed', { error: loginErr.message });
        return res.redirect('/?authError=true');
      }
      req.session._createdAt = Date.now();
      // Restore guest data for scan claiming
      req.session.guestScanTokens = guestTokens;
      req.session.guestSessionIds = guestSessionIds;
      res.redirect('/dashboard');
    });
  });
}

// ── Google OAuth ───────────────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?authError=true' }),
  oauthCallbackHandler
);

// ── GitHub OAuth ───────────────────────────────────────────────
router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
router.get('/github/callback',
  passport.authenticate('github', { failureRedirect: '/?authError=true' }),
  oauthCallbackHandler
);

// ── LinkedIn OAuth ─────────────────────────────────────────────
router.get('/linkedin', passport.authenticate('linkedin', { state: true }));
router.get('/linkedin/callback',
  passport.authenticate('linkedin', { failureRedirect: '/?authError=true' }),
  oauthCallbackHandler
);

// Phase 6 §10.7: Cookie name must match server.js (__Host- in prod, plain in dev)
const COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-rxsid' : '__rxsid';

// ── Logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((err) => {
      if (err) log.error('Session destroy error on logout', { error: err.message });
      res.clearCookie(COOKIE_NAME);
      res.json({ success: true });
    });
  });
});

// ── Verification & Recovery ────────────────────────────────────

router.get('/verify/:token', async (req, res) => {
  try {
    const user = await db.getUserByVerificationToken(req.params.token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token.' });
    }
    await db.verifyUser(user.id);
    res.json({ success: true, message: 'Email verified successfully! You can now access all features.' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    // §10.14: Early validation — same pattern as signup
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }
    const user = await db.getUserByEmail(email);
    
    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour
    
    await db.setResetToken(email, resetToken, expires);
    await mailer.sendPasswordResetEmail(email, resetToken);
    
    res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (!/\d/.test(password)) {
      return res.status(400).json({ error: 'Password must contain at least one number.' });
    }

    const user = await db.getUserByResetToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token. Please request a new reset link.' });
    }

    const hashed = await bcrypt.hash(password, 12);
    await db.updatePassword(user.id, hashed);
    
    res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (err) {
    log.error('Password reset failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to reset password. Please try again or request a new link.' });
  }
});

// ── Phase 6 §7.7: Account Linking — Verify password before linking OAuth ────

router.post('/link-account', async (req, res) => {
  try {
    const { password } = req.body;
    const pendingLink = req.session?.pendingLink;

    if (!pendingLink) {
      return res.status(400).json({ error: 'No pending account link. Please try signing in again.' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required to link your account.' });
    }

    // Verify the password against the existing account
    const user = await db.getUserById(pendingLink.userId);
    if (!user || !user.password_hash) {
      delete req.session.pendingLink;
      return res.status(400).json({ error: 'Account not found. Please sign up instead.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    // Password verified — link the OAuth provider
    const linkedUser = await db.linkOAuthProvider(
      pendingLink.userId,
      pendingLink.provider,
      pendingLink.profileId
    );

    // Clean up and log in
    delete req.session.pendingLink;

    req.login(linkedUser, (err) => {
      if (err) {
        log.error('Login after account link failed', { error: err.message });
        return res.status(500).json({ error: 'Account linked but login failed. Please sign in.' });
      }
      log.info('OAuth account linked successfully', {
        userId: pendingLink.userId,
        provider: pendingLink.provider
      });
      res.json({
        success: true,
        user: { id: linkedUser.id, name: linkedUser.name, email: linkedUser.email },
        message: `${pendingLink.provider} account linked successfully!`
      });
    });
  } catch (err) {
    log.error('Account link error', { error: err.message });
    res.status(500).json({ error: 'Failed to link account. Please try again.' });
  }
});

module.exports = router;
