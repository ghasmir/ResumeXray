// ── Phase 5 §3: Strategy Pattern — PostgreSQL / SQLite Toggle ─────────────────
// When DB_ENGINE=postgresql, delegate to the Supabase-backed PG module.
// Default: sqlite (for local development / backward compatibility).
const DB_ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();
if (DB_ENGINE === 'postgresql' || DB_ENGINE === 'postgres' || DB_ENGINE === 'pg') {
  module.exports = require('./pg-database');
  return;
}

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const log = require('../lib/logger');

const DB_PATH = path.join(__dirname, 'resumexray.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000'); // Retry for 5s instead of SQLITE_BUSY crash
    runMigrations(db);

    // H-8: WAL checkpoint every 5 minutes — prevents unbounded WAL growth and
    // reduces data-loss window on crash. TRUNCATE resets the WAL file to zero.
    setInterval(
      () => {
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          /* non-fatal */
        }
      },
      5 * 60 * 1000
    ).unref();
  }
  return db;
}

function runMigrations(database) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  database.exec(schema);

  // ── Schema Migrations ──────────────────────────────────────────────────────
  // Track applied migrations so we can skip already-run ALTER TABLE operations.
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map(r => r.version)
  );

  function migrate(version, sql) {
    if (applied.has(version)) return;
    try {
      database.exec(sql);
    } catch (err) {
      // SQLite throws "duplicate column name" if ALTER TABLE ADD COLUMN
      // is run on a fresh DB where schema.sql already has the column.
      if (err.message && err.message.includes('duplicate column name')) {
        log.info(`Migration ${version} skipped (column already exists)`);
      } else {
        throw err;
      }
    }
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    log.info(`Migration applied: ${version}`);
  }
  // Add password_hash column if missing (migration for existing DBs)
  migrate('v1_password_hash', 'ALTER TABLE users ADD COLUMN password_hash TEXT');

  // Add agent optimization columns to scans table
  for (const col of ['optimized_bullets', 'keyword_plan', 'optimized_resume_text']) {
    migrate(`v1_scans_${col}`, `ALTER TABLE scans ADD COLUMN ${col} TEXT`);
  }

  // Add Verification and Reset columns to users table
  const authCols = [
    { name: 'is_verified', type: 'INTEGER DEFAULT 0' },
    { name: 'verification_token', type: 'TEXT' },
    { name: 'reset_password_token', type: 'TEXT' },
    { name: 'reset_password_expires', type: 'TEXT' },
  ];
  for (const col of authCols) {
    migrate(`v1_users_${col.name}`, `ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
  }

  // Add verification_token_expires column (24h token expiry)
  migrate(
    'v2_verification_token_expires',
    'ALTER TABLE users ADD COLUMN verification_token_expires TEXT'
  );

  // Add credit_balance column if missing
  migrate('v1_credit_balance', 'ALTER TABLE users ADD COLUMN credit_balance INTEGER DEFAULT 1');

  // Add tier column if missing
  migrate('v1_tier', "ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free'");

  // Add email_verified_at column
  migrate('v2_email_verified_at', 'ALTER TABLE users ADD COLUMN email_verified_at TEXT');

  // Add stripe_customer_id column
  migrate('v1_stripe_customer_id', 'ALTER TABLE users ADD COLUMN stripe_customer_id TEXT UNIQUE');

  // Add scans_used column
  migrate('v1_scans_used', 'ALTER TABLE users ADD COLUMN scans_used INTEGER DEFAULT 0');

  // Add ai_credits_used column
  migrate('v1_ai_credits_used', 'ALTER TABLE users ADD COLUMN ai_credits_used INTEGER DEFAULT 0');

  // Add cover_letter_text column to scans table
  migrate('v1_cover_letter_text', 'ALTER TABLE scans ADD COLUMN cover_letter_text TEXT');

  // Add access_token to scans for guest IDOR protection
  migrate('v1_access_token', 'ALTER TABLE scans ADD COLUMN access_token TEXT');

  // Add ats_platform column to scans
  migrate('v2_ats_platform', 'ALTER TABLE scans ADD COLUMN ats_platform TEXT');

  // Persist normalized job and render contracts for results/preview/export reuse
  migrate('v3_job_context', 'ALTER TABLE scans ADD COLUMN job_context TEXT');
  migrate('v3_render_meta', 'ALTER TABLE scans ADD COLUMN render_meta TEXT');

  // Add email_hash column for PII-encrypted email lookup
  migrate('v2_email_hash', 'ALTER TABLE users ADD COLUMN email_hash TEXT UNIQUE');

  // ── INTEGRITY: Prevent negative credit balances ────────────────────────────
  try {
    const negatives = database.prepare('SELECT id FROM users WHERE credit_balance < 0').all();
    if (negatives.length > 0) {
      database.exec('UPDATE users SET credit_balance = 0 WHERE credit_balance < 0');
      log.warn('Repaired negative credit balances', { count: negatives.length });
    }
  } catch {}

  // Create credit_transactions table if missing
  database.exec(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_session_id TEXT UNIQUE,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('purchase', 'scan', 'ai_fix', 'export', 'signup_bonus', 'refund', 'cover_letter_export')),
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create download_history table for audit trail
  database.exec(`
    CREATE TABLE IF NOT EXISTS download_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scan_id INTEGER,
      idempotency_key TEXT UNIQUE NOT NULL,
      format TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'resume',
      watermarked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create index for credit_transactions
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id)'
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_credit_transactions_stripe ON credit_transactions(stripe_session_id)'
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_download_history_user ON download_history(user_id)'
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_download_history_idempotency ON download_history(idempotency_key)'
  );

  // Backfill access tokens for existing guest scans (idempotent — only runs once)
  migrate(
    'v1_access_token_backfill',
    `
    UPDATE scans SET access_token = '${uuidv4()}' WHERE user_id IS NULL AND access_token IS NULL AND id = -1
  `
  );
  // Actual backfill requires row-by-row UUID generation
  try {
    const guestScans = database
      .prepare('SELECT id FROM scans WHERE user_id IS NULL AND access_token IS NULL')
      .all();
    if (guestScans.length > 0) {
      const stmt = database.prepare('UPDATE scans SET access_token = ? WHERE id = ?');
      for (const row of guestScans) {
        stmt.run(uuidv4(), row.id);
      }
      log.info('Backfilled access tokens for guest scans', { count: guestScans.length });
    }
  } catch {}

  // ── INTEGRITY: Prevent negative credit balances ────────────────────────────
  try {
    const negatives = database.prepare('SELECT id FROM users WHERE credit_balance < 0').all();
    if (negatives.length > 0) {
      database.exec('UPDATE users SET credit_balance = 0 WHERE credit_balance < 0');
      log.warn('Repaired negative credit balances', { count: negatives.length });
    }
  } catch {}

  // ── Phase 3: Scan Sessions Table (replaces in-memory Map) ──────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      resume_text TEXT NOT NULL,
      resume_file_path TEXT,
      resume_mimetype TEXT,
      file_name TEXT,
      jd_text TEXT DEFAULT '',
      job_url TEXT DEFAULT '',
      job_title TEXT DEFAULT '',
      company_name TEXT DEFAULT '',
      job_context TEXT DEFAULT '{}',
      credit_balance INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_scan_sessions_created ON scan_sessions(created_at)'
  );
  migrate(
    'v3_scan_sessions_job_context',
    "ALTER TABLE scan_sessions ADD COLUMN job_context TEXT DEFAULT '{}'"
  );

  // ── Phase 6 §8.2: Stripe Events Idempotency Table ──────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      processed_at TEXT DEFAULT (datetime('now')),
      payload_hash TEXT
    )
  `);
  database.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_events_id ON stripe_events(event_id)'
  );

  // ── Phase 7: Lemon Squeezy Events Idempotency Table ──────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS lemon_squeezy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      processed_at TEXT DEFAULT (datetime('now')),
      payload_hash TEXT
    )
  `);
  database.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_lemon_squeezy_events_id ON lemon_squeezy_events(event_id)'
  );

  // ── H-9: Add ats_platform column to scans ────────────────────────────────
  try {
    database.prepare('SELECT ats_platform FROM scans LIMIT 1').get();
  } catch {
    database.exec('ALTER TABLE scans ADD COLUMN ats_platform TEXT');
  }

  log.info('Database schema applied');
}

// ── User helpers ──────────────────────────────────────────────────────────────

// §CRIT: Provider → column whitelist. Prevents SQL injection via string interpolation.
const PROVIDER_COLUMNS = Object.freeze({
  google: 'google_id',
  linkedin: 'linkedin_id',
  github: 'github_id',
});

function findOrCreateUser({ provider, profileId, email, name, avatarUrl }) {
  const db = getDb();
  const column = PROVIDER_COLUMNS[provider];
  if (!column) throw new Error(`Unknown OAuth provider: ${provider}`);

  // Use a transaction to prevent race conditions between SELECT and INSERT
  return db.transaction(() => {
    let user = db.prepare(`SELECT * FROM users WHERE ${column} = ?`).get(profileId);
    if (user) return decryptUserEmail(user);

    // Check if email already exists (link account) — try hash first, then plaintext
    const hash = emailHash(email);
    user = db.prepare('SELECT * FROM users WHERE email_hash = ?').get(hash);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    }
    if (user) {
      db.prepare(
        `UPDATE users
         SET ${column} = ?,
             avatar_url = CASE WHEN COALESCE(?, '') <> '' THEN ? ELSE avatar_url END,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(profileId, avatarUrl, avatarUrl, user.id);
      return decryptUserEmail(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
    }

    // Create new user with 1 signup bonus credit
    const encryptedEmail = encryptPii(email.toLowerCase().trim());
    const result = db
      .prepare(
        `INSERT INTO users (${column}, email, email_hash, name, avatar_url, credit_balance, is_verified, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?, 1, 1, NULL, NULL)`
      )
      .run(profileId, encryptedEmail, hash, name, avatarUrl);

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

    // Record the signup bonus transaction
    db.prepare(
      `INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, 1, 'signup_bonus', 'Welcome bonus credit')`
    ).run(newUser.id);

    return decryptUserEmail(newUser);
  })();
}

function getUserById(id) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return user ? decryptUserEmail(user) : null;
}

function getUserByStripeCustomerId(customerId) {
  return getDb().prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId);
}

function setStripeCustomerId(userId, customerId) {
  getDb()
    .prepare("UPDATE users SET stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(customerId, userId);
}

function incrementScanCount(userId) {
  getDb()
    .prepare(
      `UPDATE users SET scans_used = scans_used + 1, updated_at = datetime('now') WHERE id = ?`
    )
    .run(userId);
}

function incrementAiCredits(userId) {
  getDb()
    .prepare(
      `UPDATE users SET ai_credits_used = ai_credits_used + 1, updated_at = datetime('now') WHERE id = ?`
    )
    .run(userId);
}

function updateUserTier(userId, tier) {
  getDb()
    .prepare(`UPDATE users SET tier = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(tier, userId);
}

function getUserTier(userId) {
  const user = getDb().prepare('SELECT tier FROM users WHERE id = ?').get(userId);
  return user ? user.tier || 'free' : 'free';
}

function verifyUser(userId) {
  getDb()
    .prepare(
      "UPDATE users SET is_verified = 1, email_verified_at = COALESCE(email_verified_at, datetime('now')), verification_token = NULL, verification_token_expires = NULL, updated_at = datetime('now') WHERE id = ?"
    )
    .run(userId);
}

function getUserByVerificationToken(token) {
  const user = getDb()
    .prepare(
      "SELECT * FROM users WHERE verification_token = ? AND (verification_token_expires IS NULL OR verification_token_expires > datetime('now'))"
    )
    .get(token);
  return user ? decryptUserEmail(user) : null;
}

function setVerificationToken(userId, token) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  getDb()
    .prepare(
      "UPDATE users SET verification_token = ?, verification_token_expires = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(token, expires, userId);
}

function getUserByResetToken(token) {
  const user = getDb()
    .prepare(
      "SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > datetime('now')"
    )
    .get(token);
  return user ? decryptUserEmail(user) : null;
}

function setResetToken(email, token, expires) {
  // C-3 Fix: use email_hash for the WHERE clause so the encrypted email column
  // is used, not the plaintext email. This is consistent with getUserByEmail.
  const hash = emailHash(email);
  getDb()
    .prepare(
      "UPDATE users SET reset_password_token = ?, reset_password_expires = ?, updated_at = datetime('now') WHERE email_hash = ?"
    )
    .run(token, expires, hash);
}

function updatePassword(userId, passwordHash) {
  getDb()
    .prepare(
      "UPDATE users SET password_hash = ?, reset_password_token = NULL, reset_password_expires = NULL, updated_at = datetime('now') WHERE id = ?"
    )
    .run(passwordHash, userId);
}

/**
 * Phase 6 §7.7: Link an OAuth provider to an existing account after password verification.
 * Called from the /auth/link-account route after the user confirms their password.
 */
function linkOAuthProvider(userId, provider, profileId, avatarUrl) {
  const d = getDb();
  const column = PROVIDER_COLUMNS[provider];
  if (!column) throw new Error(`Unknown OAuth provider: ${provider}`);
  d.prepare(
    `UPDATE users
     SET ${column} = ?,
         avatar_url = CASE WHEN COALESCE(?, '') <> '' THEN ? ELSE avatar_url END,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(profileId, avatarUrl, avatarUrl, userId);
  return decryptUserEmail(d.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

// §10.8: Auth helpers — match PG adapter interface
function getUserByEmail(email) {
  // Try email_hash lookup first (for encrypted emails), fall back to plaintext
  const hash = emailHash(email);
  let user = getDb().prepare('SELECT * FROM users WHERE email_hash = ?').get(hash);
  if (!user) {
    // Fallback for plaintext emails during migration period
    user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  }
  return user ? decryptUserEmail(user) : null;
}

function createUser({ email, name, passwordHash, verificationToken }) {
  const verificationTokenExpires = verificationToken
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    : null;
  const encryptedEmail = encryptPii(email.toLowerCase().trim());
  const hash = emailHash(email);
  const result = getDb()
    .prepare(
      'INSERT INTO users (email, email_hash, name, password_hash, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(encryptedEmail, hash, name, passwordHash, verificationToken, verificationTokenExpires);
  return result.lastInsertRowid;
}

function claimGuestScans(userId, accessTokens) {
  if (!accessTokens || accessTokens.length === 0) return 0;
  const placeholders = accessTokens.map(() => '?').join(',');
  const result = getDb()
    .prepare(
      `UPDATE scans SET user_id = ? WHERE user_id IS NULL AND access_token IN (${placeholders})`
    )
    .run(userId, ...accessTokens);
  return result.changes;
}

// ── Credit System Helpers ─────────────────────────────────────────────────────

/**
 * Get a user's current credit balance.
 */
function getCreditBalance(userId) {
  const user = getDb().prepare('SELECT credit_balance FROM users WHERE id = ?').get(userId);
  return user ? user.credit_balance || 0 : 0;
}

/**
 * Add credits to a user's account (purchase, bonus, refund).
 * Uses stripe_session_id for idempotency — if the same session_id is used twice, it silently skips.
 * Returns true if credits were added, false if already processed.
 */
function addCredits(userId, amount, type, stripeSessionId = null, description = '') {
  const db = getDb();

  const txn = db.transaction(() => {
    // §CRIT: Idempotency check INSIDE transaction — prevents TOCTOU race.
    // Two concurrent Stripe webhooks could both pass the check before either inserts.
    if (stripeSessionId) {
      const existing = db
        .prepare('SELECT id FROM credit_transactions WHERE stripe_session_id = ?')
        .get(stripeSessionId);
      if (existing) {
        log.warn('Duplicate stripe session — skipping credit add', { stripeSessionId });
        return false;
      }
    }

    db.prepare(
      "UPDATE users SET credit_balance = credit_balance + ?, updated_at = datetime('now') WHERE id = ?"
    ).run(amount, userId);

    db.prepare(
      'INSERT INTO credit_transactions (user_id, stripe_session_id, amount, type, description) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, stripeSessionId, amount, type, description);

    return true;
  });

  const result = txn();
  if (result !== false) {
    log.info('Credits added', { userId, amount, type });
  }
  return result;
}

/**
 * @deprecated Use deductCreditAtomic() instead — this function has a TOCTOU
 * race condition (reads balance then deducts in two operations). It is kept
 * only for backward compatibility and must NOT be used in new code.
 *
 * Deduct a credit from a user's account.
 * Returns true if successfully deducted, false if insufficient balance.
 */
function deductCredit(userId, type, description = '') {
  const db = getDb();
  const user = db.prepare('SELECT credit_balance FROM users WHERE id = ?').get(userId);

  if (!user || (user.credit_balance ?? 0) < 1) {
    return false;
  }

  const txn = db.transaction(() => {
    db.prepare(
      "UPDATE users SET credit_balance = credit_balance - 1, updated_at = datetime('now') WHERE id = ?"
    ).run(userId);

    db.prepare(
      'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, -1, ?, ?)'
    ).run(userId, type, description);
  });

  txn();
  return true;
}

/**
 * Atomic credit deduction with idempotency key.
 * Prevents double-deduction from rapid clicks or retries.
 * Returns { success: boolean, alreadyProcessed: boolean }
 */
function deductCreditAtomic(userId, type, idempotencyKey, description = '') {
  const db = getDb();

  // Idempotency check — if this key was already processed, skip
  const existing = db
    .prepare('SELECT id FROM download_history WHERE idempotency_key = ?')
    .get(idempotencyKey);
  if (existing) {
    log.warn('Duplicate export key — skipping deduction', { idempotencyKey });
    return { success: true, alreadyProcessed: true };
  }

  const txn = db.transaction(() => {
    // CRITICAL FIX: Balance check INSIDE transaction prevents TOCTOU race.
    // This is the ONLY place where balance should be checked for deduction.
    // The middleware (checkExportCredit) no longer makes balance decisions.
    const user = db.prepare('SELECT credit_balance FROM users WHERE id = ?').get(userId);
    if (!user || (user.credit_balance ?? 0) < 1) {
      return { success: false, alreadyProcessed: false };
    }

    db.prepare(
      "UPDATE users SET credit_balance = credit_balance - 1, updated_at = datetime('now') WHERE id = ?"
    ).run(userId);

    db.prepare(
      'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, -1, ?, ?)'
    ).run(userId, type, description);

    // Parse scan info from idempotency key
    const parts = idempotencyKey.split('-');
    const scanId = parts[1] ? parseInt(parts[1]) : null;
    const format = parts[2] || 'pdf';
    const exportType = parts[3] || 'resume';

    db.prepare(
      'INSERT INTO download_history (user_id, scan_id, idempotency_key, format, type, watermarked) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(userId, scanId, idempotencyKey, format, exportType);

    return { success: true, alreadyProcessed: false };
  });

  const result = txn();
  if (result.success && !result.alreadyProcessed) {
    log.info('Atomic credit deduction', { userId, idempotencyKey });
  }
  return result;
}

/**
 * Record a watermarked download (no credit deduction).
 */
function recordWatermarkedDownload(userId, scanId, format, type = 'resume') {
  const db = getDb();
  const key = `wm-${scanId}-${format}-${type}-${Date.now()}`;
  try {
    db.prepare(
      'INSERT INTO download_history (user_id, scan_id, idempotency_key, format, type, watermarked) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(userId, scanId, key, format, type);
  } catch (e) {
    // Ignore duplicate key errors for watermarked downloads
  }
}

/**
 * Get download history for a user.
 */
function getDownloadHistory(userId, limit = 50) {
  return getDb()
    .prepare('SELECT * FROM download_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit);
}

/**
 * Get credit transaction history for a user.
 */
function getCreditHistory(userId, limit = 50) {
  return getDb()
    .prepare('SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit);
}

// ── Resume helpers ────────────────────────────────────────────────────────────

function saveResume(userId, { name, fileName, fileType, fileSize, rawText, parsedData }) {
  const result = getDb()
    .prepare(
      'INSERT INTO resumes (user_id, name, file_name, file_type, file_size, raw_text, parsed_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(userId, name, fileName, fileType, fileSize, rawText, JSON.stringify(parsedData));
  return result.lastInsertRowid;
}

function getUserResumes(userId) {
  return getDb()
    .prepare(
      'SELECT id, name, file_name, file_type, file_size, created_at, updated_at FROM resumes WHERE user_id = ? ORDER BY updated_at DESC'
    )
    .all(userId);
}

function getResume(id, userId) {
  return getDb().prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?').get(id, userId);
}

function deleteResume(id, userId) {
  getDb().prepare('DELETE FROM resumes WHERE id = ? AND user_id = ?').run(id, userId);
}

// ── Scan helpers ──────────────────────────────────────────────────────────────

function saveScan(userId, data) {
  // Generate access_token for guest scans (IDOR protection)
  const accessToken = userId ? null : uuidv4();

  const result = getDb()
    .prepare(
      `INSERT INTO scans (user_id, resume_id, job_description, job_url, job_title, company_name,
     ats_platform, job_context, parse_rate, format_health, match_rate, xray_data, format_issues,
     keyword_data, section_data, recommendations, ai_suggestions, access_token, render_meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      data.resumeId || null,
      data.jobDescription || null,
      data.jobUrl || null,
      data.jobTitle || null,
      data.companyName || null,
      data.atsPlatform || null,
      JSON.stringify(data.jobContext || {}),
      data.parseRate || 0,
      data.formatHealth || 0,
      data.matchRate || null,
      JSON.stringify(data.xrayData || {}),
      JSON.stringify(data.formatIssues || []),
      JSON.stringify(data.keywordData || {}),
      JSON.stringify(data.sectionData || {}),
      JSON.stringify(data.recommendations || []),
      JSON.stringify(data.aiSuggestions || {}),
      accessToken,
      JSON.stringify(data.renderMeta || {})
    );

  const scanId = result.lastInsertRowid;
  return { scanId, accessToken };
}

function updateScan(scanId, data) {
  const ALLOWED_COLS = [
    'resume_id',
    'job_description',
    'job_url',
    'job_title',
    'company_name',
    'ats_platform',
    'job_context',
    'parse_rate',
    'format_health',
    'match_rate',
    'xray_data',
    'format_issues',
    'keyword_data',
    'section_data',
    'recommendations',
    'ai_suggestions',
    'optimized_bullets',
    'keyword_plan',
    'optimized_resume_text',
    'cover_letter_text',
    'render_meta',
  ];
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(data)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!ALLOWED_COLS.includes(col)) continue; // Skip unknown columns
    fields.push(`${col} = ?`);
    let finalVal = val;
    if (typeof val === 'object' && val !== null) finalVal = JSON.stringify(val);
    values.push(finalVal);
  }
  if (fields.length === 0) return;
  values.push(scanId);
  getDb()
    .prepare(`UPDATE scans SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
}

function getUserScans(userId, limit = 20) {
  return getDb()
    .prepare(
      `
    SELECT id, job_title, company_name, job_url, job_description,
           parse_rate, format_health, match_rate, created_at
    FROM scans
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `
    )
    .all(userId, limit);
}

function getScan(id, userId, accessToken = null) {
  if (userId !== null && userId !== undefined) {
    // Logged-in user: match by id explicitly
    return getDb()
      .prepare('SELECT * FROM scans WHERE id = ? AND user_id = ?')
      .get(id, Number(userId));
  }
  if (!accessToken) return null;
  // Guest scan: require the access token, not just a NULL user_id.
  return getDb()
    .prepare('SELECT * FROM scans WHERE id = ? AND user_id IS NULL AND access_token = ?')
    .get(id, accessToken);
}

function updateScanWithOptimizations(
  scanId,
  { optimizedBullets, keywordPlan, optimizedResumeText, coverLetterText, atsPlatform, jobContext, renderMeta }
) {
  // H-9 Fix: atsPlatform is now persisted so the frontend can show
  // "Optimised for Greenhouse / Workday / etc."
  getDb()
    .prepare(
      `UPDATE scans SET optimized_bullets = ?, keyword_plan = ?, optimized_resume_text = ?, cover_letter_text = ?, ats_platform = ?, job_context = COALESCE(?, job_context), render_meta = COALESCE(?, render_meta) WHERE id = ?`
    )
    .run(
      JSON.stringify(optimizedBullets || []),
      JSON.stringify(keywordPlan || []),
      optimizedResumeText || null,
      coverLetterText || null,
      atsPlatform || null,
      jobContext ? JSON.stringify(jobContext) : null,
      renderMeta ? JSON.stringify(renderMeta) : null,
      scanId
    );
}

function getFullScan(scanId, userId = null, accessToken = null) {
  let scan;
  if (userId !== null && userId !== undefined) {
    scan = getDb()
      .prepare('SELECT * FROM scans WHERE id = ? AND user_id = ?')
      .get(scanId, Number(userId));
  } else {
    if (!accessToken) return null;
    scan = getDb()
      .prepare('SELECT * FROM scans WHERE id = ? AND user_id IS NULL AND access_token = ?')
      .get(scanId, accessToken);
  }
  if (!scan) return null;
  const jsonCols = [
    'xray_data',
    'format_issues',
    'keyword_data',
    'section_data',
    'recommendations',
    'ai_suggestions',
    'optimized_bullets',
    'keyword_plan',
    'job_context',
    'render_meta',
  ];
  for (const col of jsonCols) {
    if (scan[col]) {
      try {
        scan[col] = JSON.parse(scan[col]);
      } catch {}
    }
  }
  return scan;
}

// ── Job tracker helpers ───────────────────────────────────────────────────────

function saveJob(userId, data) {
  const result = getDb()
    .prepare(
      `INSERT INTO jobs (user_id, scan_id, company, title, url, status, notes, applied_at, deadline, salary_min, salary_max, location, remote)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      data.scanId || null,
      data.company,
      data.title,
      data.url || null,
      data.status || 'saved',
      data.notes || null,
      data.appliedAt || null,
      data.deadline || null,
      data.salaryMin || null,
      data.salaryMax || null,
      data.location || null,
      data.remote || null
    );
  return result.lastInsertRowid;
}

function getUserJobs(userId, limit = 100) {
  return getDb()
    .prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(userId, limit);
}

function updateJob(id, userId, data) {
  const ALLOWED_COLS = [
    'company',
    'title',
    'url',
    'status',
    'notes',
    'applied_at',
    'deadline',
    'salary_min',
    'salary_max',
    'location',
    'remote',
  ];
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(data)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!ALLOWED_COLS.includes(col)) continue; // Skip unknown columns
    fields.push(`${col} = ?`);
    values.push(val);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id, userId);
  getDb()
    .prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...values);
}

function deleteJob(id, userId) {
  getDb().prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?').run(id, userId);
}

// ── Cover letter helpers ──────────────────────────────────────────────────────

function saveCoverLetter(userId, { scanId, title, content }) {
  const result = getDb()
    .prepare('INSERT INTO cover_letters (user_id, scan_id, title, content) VALUES (?, ?, ?, ?)')
    .run(userId, scanId || null, title || 'Untitled', content);
  return result.lastInsertRowid;
}

function getUserCoverLetters(userId) {
  return getDb()
    .prepare(
      'SELECT id, title, scan_id, created_at FROM cover_letters WHERE user_id = ? ORDER BY created_at DESC'
    )
    .all(userId);
}

function getCoverLetter(id, userId) {
  return getDb()
    .prepare('SELECT * FROM cover_letters WHERE id = ? AND user_id = ?')
    .get(id, userId);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function updateAvatarUrl(userId, avatarUrl) {
  getDb()
    .prepare("UPDATE users SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?")
    .run(avatarUrl, userId);
}

function deleteUserAccount(userId) {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM download_history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM credit_transactions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM cover_letters WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM jobs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM scans WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM resumes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  txn();
}

// ── Guest scan helpers ────────────────────────────────────────────────────────

function recordGuestScan(ipAddress) {
  const db = getDb();
  db.prepare('INSERT INTO guest_scans (ip_address) VALUES (?)').run(ipAddress);
}

function getGuestScanCount(ipAddress) {
  const db = getDb();
  const result = db
    .prepare(
      "SELECT COUNT(*) as count FROM guest_scans WHERE ip_address = ? AND created_at > datetime('now', '-1 day')"
    )
    .get(ipAddress);
  return result ? result.count : 0;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// ── Scan Session Helpers (Phase 3: #13 — Database Sessions) ──────────────────

/**
 * Create a scan session in the database (replaces in-memory Map).
 * Returns the session ID.
 */
function createScanSession(sessionId, data) {
  const d = getDb();
  d.prepare(
    `
    INSERT INTO scan_sessions (id, user_id, resume_text, resume_file_path, resume_mimetype, file_name, jd_text, job_url, job_title, company_name, job_context, credit_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    sessionId,
    data.userId || null,
    data.resumeText,
    data.resumeFilePath || null,
    data.resumeMimetype || null,
    data.fileName || null,
    data.jdText || '',
    data.jobUrl || '',
    data.jobTitle || '',
    data.companyName || '',
    JSON.stringify(data.jobContext || {}),
    data.creditBalance || 0
  );
  return sessionId;
}

/**
 * Get a scan session from the database.
 */
function getScanSession(sessionId) {
  const d = getDb();
  return d.prepare('SELECT * FROM scan_sessions WHERE id = ?').get(sessionId);
}

/**
 * Delete a scan session (cleanup after processing).
 */
function deleteScanSession(sessionId) {
  const d = getDb();
  d.prepare('DELETE FROM scan_sessions WHERE id = ?').run(sessionId);
}

/**
 * Purge expired scan sessions (TTL: 10 minutes).
 * Called periodically by the server.
 */
function purgeExpiredScanSessions() {
  const d = getDb();
  const result = d
    .prepare("DELETE FROM scan_sessions WHERE created_at < datetime('now', '-10 minutes')")
    .run();
  if (result.changes > 0) {
    log.info('Purged expired scan sessions', { count: result.changes });
  }
}

// ── PII: Email Hash + Decrypt Helpers ────────────────────────────────────────

function emailHash(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function decryptUserEmail(user) {
  if (!user) return user;
  user.email = decryptPii(user.email);
  return user;
}

// ── PII Encryption Helpers (Phase 4: #19) ────────────────────────────────────

const PII_ALGORITHM = 'aes-256-gcm';
const PII_KEY_ENV = 'PII_ENCRYPTION_KEY'; // 32-byte hex key in .env

/**
 * Get the PII encryption key from environment.
 * Returns null if not configured (encryption disabled).
 */
function getPiiKey() {
  const hex = process.env[PII_KEY_ENV];
  if (!hex || hex.length !== 64) return null; // Require 32-byte (64 hex chars)
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a string value for PII storage.
 * Returns 'iv:authTag:ciphertext' or the original string if key not configured.
 */
function encryptPii(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return plaintext;
  const key = getPiiKey();
  if (!key) return plaintext; // Encryption disabled — pass through

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(PII_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a PII-encrypted string.
 * Returns the plaintext or the original string if not encrypted.
 */
function decryptPii(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;
  const key = getPiiKey();
  if (!key) return ciphertext; // Encryption disabled — pass through

  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext; // Not encrypted — return as-is

  try {
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(PII_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return ciphertext; // Decryption failed — return as-is (may not be encrypted)
  }
}

// ── Phase 6 §8.2–8.3: Stripe Event Idempotency ──────────────────────────────

/**
 * Check if a Stripe event has already been processed.
 * Returns true if the event was already handled (skip processing).
 */
function isStripeEventProcessed(eventId) {
  const d = getDb();
  const existing = d.prepare('SELECT id FROM stripe_events WHERE event_id = ?').get(eventId);
  return !!existing;
}

/**
 * Record a Stripe event as processed.
 * Called after successful handling to prevent reprocessing on retries.
 */
function recordStripeEvent(eventId, eventType, payloadHash = null) {
  const d = getDb();
  try {
    d.prepare(
      'INSERT INTO stripe_events (event_id, event_type, payload_hash) VALUES (?, ?, ?)'
    ).run(eventId, eventType, payloadHash);
  } catch (err) {
    // UNIQUE constraint violation = already recorded, safe to ignore
    if (!err.message.includes('UNIQUE')) throw err;
  }
}

// ── Phase 7: Lemon Squeezy Event Idempotency ──────────────────────────────

/**
 * Check if a Lemon Squeezy event has already been processed.
 * Returns true if the event was already handled (skip processing).
 */
function isLemonSqueezyEventProcessed(eventId) {
  const d = getDb();
  const existing = d.prepare('SELECT id FROM lemon_squeezy_events WHERE event_id = ?').get(eventId);
  return !!existing;
}

/**
 * Record a Lemon Squeezy event as processed.
 * Called after successful handling to prevent reprocessing on retries.
 */
function recordLemonSqueezyEvent(eventId, eventType, payloadHash = null) {
  const d = getDb();
  try {
    d.prepare(
      'INSERT INTO lemon_squeezy_events (event_id, event_type, payload_hash) VALUES (?, ?, ?)'
    ).run(eventId, eventType, payloadHash);
  } catch (err) {
    // UNIQUE constraint violation = already recorded, safe to ignore
    if (!err.message.includes('UNIQUE')) throw err;
  }
}

module.exports = {
  getDb,
  findOrCreateUser,
  getUserById,
  getUserByStripeCustomerId,
  setStripeCustomerId,
  getUserByEmail,
  createUser,
  claimGuestScans,
  linkOAuthProvider,
  incrementScanCount,
  incrementAiCredits,
  getCreditBalance,
  addCredits,
  deductCredit,
  deductCreditAtomic,
  getCreditHistory,
  recordWatermarkedDownload,
  getDownloadHistory,
  updateUserTier,
  getUserTier,
  saveResume,
  getUserResumes,
  getResume,
  deleteResume,
  saveScan,
  updateScan,
  getUserScans,
  getScan,
  updateScanWithOptimizations,
  getFullScan,
  saveJob,
  getUserJobs,
  updateJob,
  deleteJob,
  saveCoverLetter,
  getUserCoverLetters,
  getCoverLetter,
  recordGuestScan,
  getGuestScanCount,
  updateAvatarUrl,
  deleteUserAccount,
  closeDb,
  verifyUser,
  getUserByVerificationToken,
  setVerificationToken,
  getUserByResetToken,
  setResetToken,
  updatePassword,
  // Phase 3: Scan Sessions
  createScanSession,
  getScanSession,
  deleteScanSession,
  purgeExpiredScanSessions,
  // Phase 4: PII Encryption
  encryptPii,
  decryptPii,
  emailHash,
  // Phase 6: Stripe Idempotency
  isStripeEventProcessed,
  recordStripeEvent,
  // Phase 7: Lemon Squeezy Idempotency
  isLemonSqueezyEventProcessed,
  recordLemonSqueezyEvent,
};
