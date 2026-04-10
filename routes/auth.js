const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db/database');
const mailer = require('../lib/mailer');
const { authLimiter } = require('../config/security');
const { validatePassword, validateEmail } = require('../lib/validation');
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
  // Cap map size to prevent unbounded memory growth from distributed attacks
  if (loginAttempts.size > 10000) {
    const now = Date.now();
    for (const [k, v] of loginAttempts) {
      if (now - v.firstAttempt > LOCKOUT_WINDOW || (v.lockedUntil && now >= v.lockedUntil)) {
        loginAttempts.delete(k);
      }
    }
    // If still over limit after cleanup, drop oldest entries
    if (loginAttempts.size > 10000) {
      const toDelete = loginAttempts.size - 8000;
      let deleted = 0;
      for (const k of loginAttempts.keys()) {
        if (deleted >= toDelete) break;
        loginAttempts.delete(k);
        deleted++;
      }
    }
  }
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
    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: emailCheck.error });
    }
    // §10.14: Name length guard
    if (name.length > 100) {
      return res.status(400).json({ error: 'Name must be 100 characters or fewer.' });
    }
    // §10.13: NIST 800-63B password policy
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    // Check if user already exists
    const existing = await db.getUserByEmail(email);
    if (existing) {
      // If the account is SSO-only, tell the user which provider they used
      if (!existing.password_hash) {
        const provider = existing.google_id ? 'Google' : existing.linkedin_id ? 'LinkedIn' : existing.github_id ? 'GitHub' : null;
        if (provider) {
          return res.status(409).json({
            error: `This email is linked to a ${provider} account. Please use "Continue with ${provider}" on the login page.`,
            ssoProvider: provider.toLowerCase()
          });
        }
      }
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

    // Save guest scan tokens BEFORE regenerating (regenerate destroys session data)
    const savedGuestTokens = req.session.guestScanTokens || [];
    const savedGuestSessionIds = req.session.guestSessionIds || [];

    // Auto-login after signup with session regeneration
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ error: 'Account created but login failed.' });
      req.login(user, async (err) => {
        if (err) return res.status(500).json({ error: 'Account created but login failed.' });
        req.session._createdAt = Date.now(); // Set absolute timeout anchor

        // Phase 6 §3.1-A: Claim only THIS session's guest scans (IDOR fix)
        // Tokens were saved before regenerate — use the saved copies.
        try {
          if (savedGuestTokens.length > 0) {
            const claimResult = await db.claimGuestScans(user.id, savedGuestTokens);
            if (claimResult > 0) {
              log.info('Claimed guest scans for new user', { userId: user.id, claimed: claimResult });
            }
          }
        } catch (claimErr) {
          log.warn('Failed to claim guest scans', { error: claimErr.message });
        }

        res.json({ 
          success: true, 
          user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
          needsVerification: true,
          message: 'Account created! Check your email to verify and unlock your welcome credit.'
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
    req.login(user, async (loginErr) => {
      if (loginErr) {
        log.error('OAuth re-login after regeneration failed', { error: loginErr.message });
        return res.redirect('/?authError=true');
      }
      req.session._createdAt = Date.now();

      // Claim guest scans from before OAuth login
      if (guestTokens.length > 0) {
        try {
          const claimed = await db.claimGuestScans(user.id, guestTokens);
          if (claimed > 0) log.info('Claimed guest scans for OAuth user', { userId: user.id, claimed });
        } catch (e) {
          log.warn('Failed to claim guest scans on OAuth login', { error: e.message });
        }
      }

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
  const isProd = process.env.NODE_ENV === 'production';
  // Must match the attributes set in server.js session config; otherwise
  // clearCookie() is a no-op for __Host-prefixed cookies and the client keeps
  // sending the old session ID, leading to "logged back in after logout".
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
  };
  req.logout((err) => {
    if (err) return next(err);
    const finish = () => {
      res.clearCookie(COOKIE_NAME, cookieOpts);
      // Prevent any intermediary/browser cache from serving a stale auth response
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.json({ success: true });
    };
    if (req.session && typeof req.session.destroy === 'function') {
      req.session.destroy((destroyErr) => {
        if (destroyErr) log.error('Session destroy error on logout', { error: destroyErr.message });
        finish();
      });
    } else {
      finish();
    }
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
    res.json({
      success: true,
      creditGranted: true,
      message: 'Email verified! Your welcome credit has been unlocked. You can now run your first scan.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// POST /auth/resend-verification — Resend verification email for logged-in unverified users
router.post('/resend-verification', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.is_verified) {
      return res.json({ success: true, message: 'Your email is already verified.' });
    }
    if (!user.verification_token) {
      // Re-generate token if it was cleared
      const crypto = require('crypto');
      const newToken = crypto.randomBytes(32).toString('hex');
      await db.setVerificationToken(user.id, newToken);
      mailer.sendVerificationEmail(user.email, newToken).catch(err => {
        log.error('Failed to resend verification email', { error: err.message });
      });
    } else {
      mailer.sendVerificationEmail(user.email, user.verification_token).catch(err => {
        log.error('Failed to resend verification email', { error: err.message });
      });
    }
    res.json({ success: true, message: 'Verification email resent.' });
  } catch (err) {
    log.error('Resend verification error', { error: err.message });
    res.status(500).json({ error: 'Failed to resend verification email.' });
  }
});



router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    // §10.14: Early validation — same pattern as signup
    if (!validateEmail(email).valid) {
      return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }
    const user = await db.getUserByEmail(email);

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }

    // SSO-only users don't have a password — send a reminder email instead of a reset link
    if (!user.password_hash) {
      const provider = user.google_id ? 'Google' : user.linkedin_id ? 'LinkedIn' : user.github_id ? 'GitHub' : null;
      if (provider) {
        mailer.sendSSOLoginReminderEmail(email, provider).catch(err => {
          log.error('Failed to send SSO login reminder email', { error: err.message });
        });
        return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
      }
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

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    const user = await db.getUserByResetToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token. Please request a new reset link.' });
    }

    // Prevent reusing the same password
    if (user.password_hash) {
      const isSame = await bcrypt.compare(password, user.password_hash);
      if (isSame) {
        return res.status(400).json({ error: 'New password cannot be the same as your previous password.' });
      }
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
