const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../lib/validation');
const log = require('../lib/logger');

// All routes require authentication (except /me which checks gracefully)
router.use((req, res, next) => {
  if (req.path === '/me' && !req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// GET /user/me — Returns user info with tier and credit balance
router.get('/me', isAuthenticated, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    const creditBalance = await db.getCreditBalance(req.user.id);
    const tier = await db.getUserTier(req.user.id);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar_url,
        tier,
        creditBalance,
        scansUsed: user.scans_used,
        joinedAt: user.created_at,
      }
    });
  } catch (err) {
    log.error('Fetch user error', { error: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// GET /user/dashboard
router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const scans = await db.getUserScans(req.user.id, 5);
    const jobs = await db.getUserJobs(req.user.id);
    const resumes = await db.getUserResumes(req.user.id);
    const creditBalance = await db.getCreditBalance(req.user.id);
    const tier = await db.getUserTier(req.user.id);
    const creditHistory = await db.getCreditHistory(req.user.id, 10);

    res.json({ scans, jobs, resumes, creditBalance, tier, creditHistory });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /user/credit-history — Paginated credit transactions
router.get('/credit-history', isAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const history = await db.getCreditHistory(req.user.id, limit);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load credit history' });
  }
});

// PUT /user/password — Change password
router.put('/password', isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    // §10.13: Match signup password policy
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    const user = await db.getUserById(req.user.id);
    if (user.password_hash) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required.' });
      }
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      // Prevent reusing the same password
      const isSame = await bcrypt.compare(newPassword, user.password_hash);
      if (isSame) {
        return res.status(400).json({ error: 'New password cannot be the same as your current password.' });
      }
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await db.updatePassword(req.user.id, hash);

    // Force re-login after password change — prevents old sessions from persisting
    req.session.regenerate((err) => {
      if (err) log.error('Session regeneration error after password change', { error: err.message });
      res.json({ success: true, message: 'Password updated successfully. Please log in again.', requireRelogin: true });
    });
  } catch (err) {
    log.error('Password change error', { error: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

// PUT /user/avatar — Upload avatar image
router.put('/avatar', isAuthenticated, express.raw({ type: 'image/*', limit: '2mb' }), async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'No image data provided.' });
    }

    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // §10.14: Validate content type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const contentType = req.headers['content-type'] || 'image/jpeg';
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, or WebP images are allowed.' });
    }

    const ext = contentType.split('/')[1] || 'jpg';
    const filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
    const filepath = path.join(uploadsDir, filename);

    fs.writeFileSync(filepath, req.body);

    const avatarUrl = `/uploads/avatars/${filename}`;
    // §10.8: Use helper instead of raw prepare() for PG compatibility
    const { getDb } = db;
    if (typeof getDb === 'function') {
      const dbInst = getDb();
      if (dbInst.query) {
        // PG mode
        await dbInst.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, req.user.id]);
      } else {
        // SQLite mode
        dbInst.prepare("UPDATE users SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?")
          .run(avatarUrl, req.user.id);
      }
    }

    res.json({ success: true, avatarUrl });
  } catch (err) {
    log.error('Avatar upload error', { error: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to upload avatar.' });
  }
});

// DELETE /user/account — Delete user account
router.delete('/account', isAuthenticated, async (req, res) => {
  try {
    const { confirmEmail } = req.body;
    const user = await db.getUserById(req.user.id);

    if (confirmEmail !== user.email) {
      return res.status(400).json({ error: 'Email confirmation does not match.' });
    }

    await db.deleteUserAccount(req.user.id);
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie(process.env.NODE_ENV === 'production' ? '__Host-rxsid' : '__rxsid');
        res.json({ success: true, message: 'Account deleted successfully.' });
      });
    });
  } catch (err) {
    log.error('Account deletion error', { error: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

module.exports = router;
