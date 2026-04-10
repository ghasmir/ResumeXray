const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../lib/validation');
const log = require('../lib/logger');

// All routes require authentication
router.use((req, res, next) => {
  if (req.path === '/me' && !req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// ── Magic Number Validation ───────────────────────────────────────────────────
// Validates file binary signature (not just extension/Content-Type header)
// which can be spoofed by attackers. Only JPEG and PNG allowed.
const IMAGE_MAGIC = {
  jpeg: [0xFF, 0xD8, 0xFF],  // JFIF / Exif / JFXX marker
  png:  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],  // PNG signature
};

function detectImageType(buffer) {
  if (!buffer || buffer.length < 8) return null;
  const isPng = IMAGE_MAGIC.png.every((byte, i) => buffer[i] === byte);
  if (isPng) return 'png';
  const isJpeg = IMAGE_MAGIC.jpeg.every((byte, i) => buffer[i] === byte);
  if (isJpeg) return 'jpeg';
  return null; // Unknown or disallowed format
}

// Multer: in-memory storage so we can inspect the buffer before writing to disk
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    // First-line defence: content-type check (easy to spoof, but filters most noise)
    const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG and PNG images are allowed.'));
    }
    cb(null, true);
  },
});

// GET /user/me — Returns user info with tier, credit balance, and auth metadata
router.get('/me', isAuthenticated, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    const creditBalance = await db.getCreditBalance(req.user.id);
    const tier = await db.getUserTier(req.user.id);

    // Derive which OAuth providers are connected
    const provider = user.google_id ? 'google'
      : user.linkedin_id ? 'linkedin'
      : user.github_id ? 'github'
      : null;

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
        isVerified: !!user.is_verified,
        emailVerifiedAt: user.email_verified_at || null,
        provider,                        // 'google' | 'linkedin' | 'github' | null
        hasPassword: !!user.password_hash, // false for OAuth-only users
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

// PUT /user/password — Change password (email/password accounts only)
router.put('/password', isAuthenticated, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);

    // OAuth-only users have no password_hash — changing password is not applicable
    if (!user.password_hash) {
      return res.status(403).json({
        error: 'Password management is not available for accounts signed in via Google, LinkedIn, or GitHub.'
      });
    }

    const { currentPassword, newPassword } = req.body;
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

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

// PUT /user/avatar — Upload and sanitize profile picture
// Security: magic number validation + CDR (EXIF strip + re-encode via sharp) + UUID filename
router.put('/avatar', isAuthenticated, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image must be under 5MB.' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    const buffer = req.file.buffer;

    // Deep packet inspection: reject anything that doesn't match JPEG or PNG magic bytes.
    // This cannot be spoofed by changing the file extension or Content-Type header.
    const detectedType = detectImageType(buffer);
    if (!detectedType) {
      return res.status(400).json({ error: 'Invalid image format. Only JPEG and PNG files are allowed.' });
    }

    // Content Disarm and Reconstruction (CDR):
    // Re-encode the image through sharp to strip EXIF metadata, GPS data,
    // embedded thumbnails, and any potential steganographic payloads.
    // The output is a clean, re-encoded image with no metadata passthrough.
    let sanitizedBuffer;
    const outputFormat = detectedType === 'png' ? 'png' : 'jpeg';
    try {
      const sharpInstance = sharp(buffer)
        .resize(512, 512, { fit: 'cover', position: 'centre' }) // Normalize dimensions
        .withMetadata(false); // Strip ALL metadata (EXIF, IPTC, ICC, XMP)

      if (outputFormat === 'jpeg') {
        sanitizedBuffer = await sharpInstance.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      } else {
        sanitizedBuffer = await sharpInstance.png({ compressionLevel: 6 }).toBuffer();
      }
    } catch (sharpErr) {
      log.error('Sharp image processing failed', { error: sharpErr.message, userId: req.user.id });
      return res.status(400).json({ error: 'Could not process the image. Please try a different file.' });
    }

    // UUID filename — prevents directory traversal and user enumeration via filenames
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filename = `${uuidv4()}.${outputFormat === 'jpeg' ? 'jpg' : 'png'}`;
    const filepath = path.join(uploadsDir, filename);

    // Delete the old avatar file if it was locally stored (clean up disk)
    try {
      const existingUser = await db.getUserById(req.user.id);
      if (existingUser?.avatar_url?.startsWith('/uploads/avatars/')) {
        const oldPath = path.join(__dirname, '..', 'public', existingUser.avatar_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    } catch (cleanupErr) {
      log.warn('Failed to clean up old avatar', { error: cleanupErr.message });
    }

    fs.writeFileSync(filepath, sanitizedBuffer);
    const avatarUrl = `/uploads/avatars/${filename}`;

    // Update avatar_url in the database
    const { getDb } = db;
    if (typeof getDb === 'function') {
      const dbInst = getDb();
      if (dbInst.query) {
        await dbInst.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, req.user.id]);
      } else {
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
