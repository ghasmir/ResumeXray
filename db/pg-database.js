/**
 * PostgreSQL Data Access Layer — Phase 5 §3
 *
 * Drop-in replacement for the SQLite database.js module.
 * Exports the same function signatures to maintain backward compatibility.
 *
 * Architecture:
 *   - pg.Pool for connection pooling (Supabase transaction pooler on port 6543)
 *   - All queries use parameterized $1, $2 placeholders (SQL injection safe)
 *   - PII encryption via pgcrypto extension (pgp_sym_encrypt/decrypt)
 *   - Async/await throughout (unlike SQLite's synchronous API)
 *
 * IMPORTANT: Unlike the SQLite module, all functions here are ASYNC.
 * Callers must await all database calls. Since the existing codebase
 * already uses async routes, this is a transparent upgrade.
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('../lib/logger');

// ── Connection Pool ───────────────────────────────────────────────────────────

// §3.3: Pool sizing — Supabase free tier Transaction pooler has ~60 total connections.
// With 2 PM2 workers × 6 max = 12, leaving 48 for sessions, webhooks, cron, migrations.
// Never use max=20 (20 × 2 workers = 40, dangerously close to 60 limit).
const rawPoolMax = parseInt(process.env.PG_POOL_MAX, 10);
const PG_POOL_MAX = (!rawPoolMax || rawPoolMax < 2 || rawPoolMax > 20) ? 6 : rawPoolMax;
if (process.env.PG_POOL_MAX && PG_POOL_MAX !== rawPoolMax) {
  log.warn('PG_POOL_MAX out of safe range (2-20), defaulting to 6', { provided: process.env.PG_POOL_MAX });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: PG_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,  // §3.2: 5s connection timeout
  // §3.2: 5s statement timeout — prevents runaway queries from holding connections
  statement_timeout: 5_000,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on('error', (err) => {
  log.error('PostgreSQL pool error', { error: err.message });
});

pool.on('connect', () => {
  log.debug('PostgreSQL client connected');
});

// Initialize on module load: verify connection → apply schema
(async () => {
  try {
    // §3.4: Explicit connection ping — fail fast if DB is unreachable
    const t0 = Date.now();
    await pool.query('SELECT 1');
    log.info('PostgreSQL connected', { latencyMs: Date.now() - t0 });
    
    // Apply schema
    const schemaPath = path.join(__dirname, 'pg-schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      try {
        await pool.query(schema);
        log.info('PostgreSQL schema applied');
      } catch (err) {
        if (!err.message.includes('already exists')) {
          log.error('PostgreSQL schema error', { error: err.message });
        }
      }
    }
  } catch (err) {
    log.error('PostgreSQL startup failed — server may not function', { error: err.message });
  }
})();

// ── Helper: Transaction Wrapper ───────────────────────────────────────────────

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Helper: Single Row Query ──────────────────────────────────────────────────

async function queryOne(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

async function queryAll(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// ── Compatibility: getDb() stub ───────────────────────────────────────────────
// Some code may call getDb() — return the pool for raw access
function getDb() {
  return pool;
}

// ── User Helpers ──────────────────────────────────────────────────────────────

// §CRIT: Provider → column whitelist. Prevents SQL injection via string interpolation.
const PROVIDER_COLUMNS = Object.freeze({
  google:   'google_id',
  linkedin: 'linkedin_id',
  github:   'github_id',
});

async function findOrCreateUser({ provider, profileId, email, name, avatarUrl }) {
  const column = PROVIDER_COLUMNS[provider];
  if (!column) throw new Error(`Unknown OAuth provider: ${provider}`);

  let user = await queryOne(`SELECT * FROM users WHERE ${column} = $1`, [profileId]);
  if (user) return user;

  user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
  if (user) {
    // Existing password account — require re-auth before linking OAuth to prevent takeover
    if (user.password_hash) {
      return {
        ...user,
        requiresLinking: true,
        pendingProvider: provider,
        pendingProfileId: profileId,
        pendingAvatarUrl: avatarUrl
      };
    }
    // Existing OAuth account with same email — safe to auto-link
    await pool.query(
      `UPDATE users SET ${column} = $1, avatar_url = COALESCE(avatar_url, $2), updated_at = NOW() WHERE id = $3`,
      [profileId, avatarUrl, user.id]
    );
    return queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
  }

  // New user via OAuth: mark as verified immediately (email ownership proven by provider)
  // and grant the welcome credit in the same transaction.
  const newUser = await withTx(async (client) => {
    const result = await client.query(
      `INSERT INTO users (${column}, email, name, avatar_url, credit_balance, is_verified, email_verified_at)
       VALUES ($1, $2, $3, $4, 1, TRUE, NOW()) RETURNING *`,
      [profileId, email, name, avatarUrl]
    );
    const u = result.rows[0];
    await client.query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, 1, 'signup_bonus', 'Welcome credit — OAuth verified account')`,
      [u.id]
    );
    return u;
  });

  return newUser;
}

async function getUserById(id) {
  return queryOne('SELECT * FROM users WHERE id = $1', [id]);
}

async function getUserByStripeCustomerId(customerId) {
  return queryOne('SELECT * FROM users WHERE stripe_customer_id = $1', [customerId]);
}

async function setStripeCustomerId(userId, customerId) {
  await pool.query('UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2', [customerId, userId]);
}

async function incrementScanCount(userId) {
  await pool.query('UPDATE users SET scans_used = scans_used + 1, updated_at = NOW() WHERE id = $1', [userId]);
}

async function incrementAiCredits(userId) {
  await pool.query('UPDATE users SET ai_credits_used = ai_credits_used + 1, updated_at = NOW() WHERE id = $1', [userId]);
}

async function updateUserTier(userId, tier) {
  await pool.query('UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2', [tier, userId]);
}

async function getUserTier(userId) {
  const user = await queryOne('SELECT tier FROM users WHERE id = $1', [userId]);
  return user ? (user.tier || 'free') : 'free';
}

async function verifyUser(userId) {
  // Atomically mark verified + grant the welcome credit in one transaction.
  // Only grants credit if the user hasn't been verified before (email_verified_at IS NULL)
  // to prevent duplicate credit grants if the link is clicked twice.
  await withTx(async (client) => {
    const { rows } = await client.query(
      'SELECT is_verified, email_verified_at FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!rows[0]) return;

    const alreadyVerified = rows[0].email_verified_at !== null;

    await client.query(
      'UPDATE users SET is_verified = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()), verification_token = NULL, updated_at = NOW() WHERE id = $1',
      [userId]
    );

    // Only grant welcome credit on first verification
    if (!alreadyVerified) {
      await client.query(
        'UPDATE users SET credit_balance = credit_balance + 1, updated_at = NOW() WHERE id = $1',
        [userId]
      );
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, 1, 'signup_bonus', 'Welcome credit — email verified')`,
        [userId]
      );
    }
  });
}

async function getUserByVerificationToken(token) {
  return queryOne('SELECT * FROM users WHERE verification_token = $1', [token]);
}

async function setVerificationToken(userId, token) {
  await pool.query('UPDATE users SET verification_token = $1, updated_at = NOW() WHERE id = $2', [token, userId]);
}

async function getUserByResetToken(token) {
  return queryOne('SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()', [token]);
}

async function setResetToken(email, token, expires) {
  await pool.query('UPDATE users SET reset_password_token = $1, reset_password_expires = $2, updated_at = NOW() WHERE email = $3', [token, expires, email]);
}

async function updatePassword(userId, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL, updated_at = NOW() WHERE id = $2', [passwordHash, userId]);
}

// ── Credit System ─────────────────────────────────────────────────────────────

async function getCreditBalance(userId) {
  const user = await queryOne('SELECT credit_balance FROM users WHERE id = $1', [userId]);
  return user ? (user.credit_balance || 0) : 0;
}

async function addCredits(userId, amount, type, stripeSessionId = null, description = '') {
  if (stripeSessionId) {
    const existing = await queryOne('SELECT id FROM credit_transactions WHERE stripe_session_id = $1', [stripeSessionId]);
    if (existing) {
      log.warn('Duplicate stripe session — skipping credit add', { stripeSessionId });
      return false;
    }
  }

  await withTx(async (client) => {
    await client.query('UPDATE users SET credit_balance = credit_balance + $1, updated_at = NOW() WHERE id = $2', [amount, userId]);
    await client.query(
      'INSERT INTO credit_transactions (user_id, stripe_session_id, amount, type, description) VALUES ($1, $2, $3, $4, $5)',
      [userId, stripeSessionId, amount, type, description]
    );
  });

  log.info('Credits added', { userId, amount, type });
  return true;
}

async function deductCredit(userId, type, description = '') {
  return withTx(async (client) => {
    const { rows } = await client.query('SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0] || (rows[0].credit_balance ?? 0) < 1) return false;

    await client.query('UPDATE users SET credit_balance = credit_balance - 1, updated_at = NOW() WHERE id = $1', [userId]);
    await client.query(
      'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES ($1, -1, $2, $3)',
      [userId, type, description]
    );
    return true;
  });
}

async function deductCreditAtomic(userId, type, idempotencyKey, description = '') {
  return withTx(async (client) => {
    // §CRIT: Idempotency check INSIDE transaction — prevents TOCTOU race.
    // Two concurrent requests can no longer both pass the check before insert.
    const { rows: existing } = await client.query(
      'SELECT id FROM download_history WHERE idempotency_key = $1 FOR UPDATE',
      [idempotencyKey]
    );
    if (existing.length > 0) {
      log.warn('Duplicate export key — skipping deduction', { idempotencyKey });
      return { success: true, alreadyProcessed: true };
    }

    const { rows } = await client.query('SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0] || (rows[0].credit_balance ?? 0) < 1) {
      return { success: false, alreadyProcessed: false };
    }

    await client.query('UPDATE users SET credit_balance = credit_balance - 1, updated_at = NOW() WHERE id = $1', [userId]);
    await client.query(
      'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES ($1, -1, $2, $3)',
      [userId, type, description]
    );

    const parts = idempotencyKey.split('-');
    const scanId = parts[1] ? parseInt(parts[1]) : null;
    const format = parts[2] || 'pdf';
    const exportType = parts[3] || 'resume';

    await client.query(
      `INSERT INTO download_history (user_id, scan_id, idempotency_key, format, type, watermarked)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [userId, scanId, idempotencyKey, format, exportType]
    );

    return { success: true, alreadyProcessed: false };
  });
}

async function recordWatermarkedDownload(userId, scanId, format, type = 'resume') {
  const key = `wm-${scanId}-${format}-${type}-${Date.now()}`;
  try {
    await pool.query(
      'INSERT INTO download_history (user_id, scan_id, idempotency_key, format, type, watermarked) VALUES ($1, $2, $3, $4, $5, TRUE)',
      [userId, scanId, key, format, type]
    );
  } catch { /* ignore duplicate */ }
}

async function getDownloadHistory(userId, limit = 50) {
  return queryAll('SELECT * FROM download_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
}

async function getCreditHistory(userId, limit = 50) {
  return queryAll('SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
}

// ── Resume Helpers ────────────────────────────────────────────────────────────

async function saveResume(userId, { name, fileName, fileType, fileSize, rawText, parsedData }) {
  const result = await pool.query(
    'INSERT INTO resumes (user_id, name, file_name, file_type, file_size, raw_text, parsed_data) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [userId, name, fileName, fileType, fileSize, rawText, JSON.stringify(parsedData)]
  );
  return result.rows[0].id;
}

async function getUserResumes(userId) {
  return queryAll('SELECT id, name, file_name, file_type, file_size, created_at, updated_at FROM resumes WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
}

async function getResume(id, userId) {
  return queryOne('SELECT * FROM resumes WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function deleteResume(id, userId) {
  await pool.query('DELETE FROM resumes WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ── Scan Helpers ──────────────────────────────────────────────────────────────

async function saveScan(userId, data) {
  const accessToken = userId ? null : uuidv4();
  const result = await pool.query(
    `INSERT INTO scans (user_id, resume_id, job_description, job_url, job_title, company_name,
     parse_rate, format_health, match_rate, xray_data, format_issues, keyword_data, section_data,
     recommendations, ai_suggestions, access_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [
      userId, data.resumeId || null, data.jobDescription || null, data.jobUrl || null,
      data.jobTitle || null, data.companyName || null,
      data.parseRate || 0, data.formatHealth || 0, data.matchRate || null,
      JSON.stringify(data.xrayData || {}), JSON.stringify(data.formatIssues || []),
      JSON.stringify(data.keywordData || {}), JSON.stringify(data.sectionData || {}),
      JSON.stringify(data.recommendations || []), JSON.stringify(data.aiSuggestions || {}),
      accessToken
    ]
  );
  return { scanId: result.rows[0].id, accessToken };
}

async function updateScan(scanId, data) {
  const ALLOWED_COLS = ['resume_id', 'job_description', 'job_url', 'job_title', 'company_name',
    'parse_rate', 'format_health', 'match_rate', 'xray_data', 'format_issues',
    'keyword_data', 'section_data', 'recommendations', 'ai_suggestions',
    'optimized_bullets', 'keyword_plan', 'optimized_resume_text', 'cover_letter_text'];
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(data)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!ALLOWED_COLS.includes(col)) continue;
    fields.push(`${col} = $${idx++}`);
    values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
  }
  if (fields.length === 0) return;
  values.push(scanId);
  await pool.query(`UPDATE scans SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

async function getUserScans(userId, limit = 20) {
  return queryAll(`
    SELECT id, job_title, company_name, job_url, job_description,
           parse_rate, format_health, match_rate, created_at
    FROM scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
  `, [userId, limit]);
}

async function getScan(id, userId) {
  if (userId !== null && userId !== undefined) {
    return queryOne('SELECT * FROM scans WHERE id = $1 AND user_id = $2', [id, Number(userId)]);
  }
  return queryOne('SELECT * FROM scans WHERE id = $1 AND user_id IS NULL', [id]);
}

async function updateScanWithOptimizations(scanId, { optimizedBullets, keywordPlan, optimizedResumeText, coverLetterText, atsPlatform = null }) {
  await pool.query(
    'UPDATE scans SET optimized_bullets = $1, keyword_plan = $2, optimized_resume_text = $3, cover_letter_text = $4, ats_platform = $5 WHERE id = $6',
    [JSON.stringify(optimizedBullets || []), JSON.stringify(keywordPlan || []), optimizedResumeText || null, coverLetterText || null, atsPlatform, scanId]
  );
}

async function getFullScan(scanId, userId = null) {
  let scan;
  if (userId !== null && userId !== undefined) {
    scan = await queryOne('SELECT * FROM scans WHERE id = $1 AND user_id = $2', [scanId, Number(userId)]);
  } else {
    scan = await queryOne('SELECT * FROM scans WHERE id = $1 AND user_id IS NULL', [scanId]);
  }
  if (!scan) return null;
  const jsonCols = ['xray_data', 'format_issues', 'keyword_data', 'section_data', 'recommendations', 'ai_suggestions', 'optimized_bullets', 'keyword_plan'];
  for (const col of jsonCols) {
    if (scan[col] && typeof scan[col] === 'string') {
      try { scan[col] = JSON.parse(scan[col]); } catch {}
    }
  }
  return scan;
}

// ── Job Tracker ───────────────────────────────────────────────────────────────

async function saveJob(userId, data) {
  const result = await pool.query(
    `INSERT INTO jobs (user_id, scan_id, company, title, url, status, notes, applied_at, deadline, salary_min, salary_max, location, remote)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [userId, data.scanId || null, data.company, data.title, data.url || null,
     data.status || 'saved', data.notes || null, data.appliedAt || null, data.deadline || null,
     data.salaryMin || null, data.salaryMax || null, data.location || null, data.remote || null]
  );
  return result.rows[0].id;
}

async function getUserJobs(userId) {
  return queryAll('SELECT * FROM jobs WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
}

async function updateJob(id, userId, data) {
  const ALLOWED_COLS = ['company', 'title', 'url', 'status', 'notes',
    'applied_at', 'deadline', 'salary_min', 'salary_max', 'location', 'remote'];
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(data)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!ALLOWED_COLS.includes(col)) continue;
    fields.push(`${col} = $${idx++}`);
    values.push(val);
  }
  if (fields.length === 0) return;
  fields.push('updated_at = NOW()');
  values.push(id, userId);
  await pool.query(`UPDATE jobs SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`, values);
}

async function deleteJob(id, userId) {
  await pool.query('DELETE FROM jobs WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ── Cover Letters ─────────────────────────────────────────────────────────────

async function saveCoverLetter(userId, { scanId, title, content }) {
  const result = await pool.query(
    'INSERT INTO cover_letters (user_id, scan_id, title, content) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, scanId || null, title || 'Untitled', content]
  );
  return result.rows[0].id;
}

async function getUserCoverLetters(userId) {
  return queryAll('SELECT id, title, scan_id, created_at FROM cover_letters WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
}

async function getCoverLetter(id, userId) {
  return queryOne('SELECT * FROM cover_letters WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ── Guest Scans ───────────────────────────────────────────────────────────────

async function recordGuestScan(ipAddress) {
  await pool.query('INSERT INTO guest_scans (ip_address) VALUES ($1)', [ipAddress]);
}

async function getGuestScanCount(ipAddress) {
  const result = await queryOne(
    "SELECT COUNT(*)::int as count FROM guest_scans WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '1 day'",
    [ipAddress]
  );
  return result ? result.count : 0;
}

// ── Account Deletion ──────────────────────────────────────────────────────────

async function deleteUserAccount(userId) {
  await withTx(async (client) => {
    await client.query('DELETE FROM download_history WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM credit_transactions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM cover_letters WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM jobs WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM scans WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM resumes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  });
}

// ── Scan Sessions ─────────────────────────────────────────────────────────────

async function createScanSession(sessionId, data) {
  await pool.query(`
    INSERT INTO scan_sessions (id, user_id, resume_text, resume_file_path, resume_mimetype, file_name, jd_text, job_url, job_title, company_name, credit_balance)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [
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
    data.creditBalance || 0
  ]);
  return sessionId;
}

async function getScanSession(sessionId) {
  return queryOne('SELECT * FROM scan_sessions WHERE id = $1', [sessionId]);
}

async function deleteScanSession(sessionId) {
  await pool.query('DELETE FROM scan_sessions WHERE id = $1', [sessionId]);
}

async function purgeExpiredScanSessions() {
  const result = await pool.query("DELETE FROM scan_sessions WHERE created_at < NOW() - INTERVAL '10 minutes'");
  if (result.rowCount > 0) {
    log.info('Purged expired scan sessions', { count: result.rowCount });
  }
}

// ── PII Encryption (App-Level Fallback) ───────────────────────────────────────

const PII_ALGORITHM = 'aes-256-gcm';

function getPiiKey() {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, 'hex');
}

function encryptPii(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return plaintext;
  const key = getPiiKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(PII_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptPii(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;
  const key = getPiiKey();
  if (!key) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;
  try {
    const [ivHex, authTagHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv(PII_ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return ciphertext;
  }
}

// ── Stripe Event Idempotency (§8.2) ──────────────────────────────────────────

async function isStripeEventProcessed(eventId) {
  const result = await queryOne(
    'SELECT 1 FROM stripe_events WHERE event_id = $1', [eventId]
  );
  return !!result;
}

async function recordStripeEvent(eventId, eventType, payloadHash = null) {
  try {
    await pool.query(
      'INSERT INTO stripe_events (event_id, event_type, payload_hash) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING',
      [eventId, eventType, payloadHash]
    );
  } catch (err) {
    log.warn('Failed to record Stripe event', { eventId, error: err.message });
  }
}

// ── Auth Helpers (§10.8 — PG-compatible replacements for raw SQLite) ─────────

async function getUserByEmail(email) {
  return queryOne('SELECT * FROM users WHERE email = $1', [email]);
}

async function createUser({ email, name, passwordHash, verificationToken }) {
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash, verification_token)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, name, passwordHash, verificationToken]
  );
  return result.rows[0]?.id;
}

async function claimGuestScans(userId, accessTokens) {
  if (!accessTokens || accessTokens.length === 0) return 0;
  const placeholders = accessTokens.map((_, i) => `$${i + 2}`).join(',');
  const result = await pool.query(
    `UPDATE scans SET user_id = $1 WHERE user_id IS NULL AND access_token IN (${placeholders})`,
    [userId, ...accessTokens]
  );
  return result.rowCount;
}

async function linkOAuthProvider(userId, provider, profileId) {
  const column = `${provider}_id`;
  const validColumns = ['google_id', 'github_id', 'linkedin_id'];
  if (!validColumns.includes(column)) {
    throw new Error(`Invalid OAuth provider: ${provider}`);
  }
  await pool.query(
    `UPDATE users SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
    [profileId, userId]
  );
  return getUserById(userId);
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

async function closeDb() {
  await pool.end();
  log.info('PostgreSQL pool closed');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getDb, findOrCreateUser, getUserById, getUserByStripeCustomerId, setStripeCustomerId,
  getUserByEmail, createUser, claimGuestScans, linkOAuthProvider,
  incrementScanCount, incrementAiCredits,
  getCreditBalance, addCredits, deductCredit, deductCreditAtomic, getCreditHistory,
  recordWatermarkedDownload, getDownloadHistory,
  updateUserTier, getUserTier,
  saveResume, getUserResumes, getResume, deleteResume,
  saveScan, updateScan, getUserScans, getScan, updateScanWithOptimizations, getFullScan,
  saveJob, getUserJobs, updateJob, deleteJob,
  saveCoverLetter, getUserCoverLetters, getCoverLetter,
  recordGuestScan, getGuestScanCount,
  deleteUserAccount, closeDb,
  verifyUser, getUserByVerificationToken, setVerificationToken, getUserByResetToken, setResetToken, updatePassword,
  createScanSession, getScanSession, deleteScanSession, purgeExpiredScanSessions,
  encryptPii, decryptPii,
  isStripeEventProcessed, recordStripeEvent,
};
