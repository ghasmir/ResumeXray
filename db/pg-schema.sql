-- ═══════════════════════════════════════════════════════════════
-- ResumeXray PostgreSQL Schema — Phase 5 §3
-- Target: Supabase Free Tier (PostgreSQL 15)
-- ═══════════════════════════════════════════════════════════════

-- Enable pgcrypto for PII field-level encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Query safety net: kill runaway queries after 10s
SET statement_timeout = '10000';

-- ── Users ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  google_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  linkedin_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  avatar_url TEXT,
  tier TEXT DEFAULT 'free' CHECK(tier IN ('free','starter','pro','hustler')),
  credit_balance INTEGER DEFAULT 1,
  stripe_customer_id TEXT UNIQUE,
  scans_used INTEGER DEFAULT 0,
  ai_credits_used INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  verification_token TEXT,
  reset_password_token TEXT,
  reset_password_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Credit Transactions ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('purchase', 'scan', 'ai_fix', 'export', 'signup_bonus', 'refund', 'cover_letter_export')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Resumes ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS resumes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK(file_type IN ('pdf', 'docx')),
  file_size INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  parsed_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scans ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scans (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  resume_id BIGINT REFERENCES resumes(id) ON DELETE SET NULL,
  access_token TEXT,
  job_description TEXT,
  job_url TEXT,
  job_title TEXT,
  company_name TEXT,
  parse_rate DOUBLE PRECISION,
  format_health DOUBLE PRECISION,
  match_rate DOUBLE PRECISION,
  xray_data TEXT,
  format_issues TEXT,
  keyword_data TEXT,
  section_data TEXT,
  recommendations TEXT,
  ai_suggestions TEXT,
  optimized_bullets TEXT,
  keyword_plan TEXT,
  optimized_resume_text TEXT,
  cover_letter_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Jobs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id BIGINT REFERENCES scans(id) ON DELETE SET NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  status TEXT DEFAULT 'saved' CHECK(status IN ('saved','applied','interview','offer','rejected','withdrawn')),
  notes TEXT,
  applied_at TIMESTAMPTZ,
  deadline TIMESTAMPTZ,
  salary_min INTEGER,
  salary_max INTEGER,
  location TEXT,
  remote TEXT CHECK(remote IN ('onsite','hybrid','remote')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Cover Letters ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cover_letters (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id BIGINT REFERENCES scans(id) ON DELETE SET NULL,
  title TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Guest Scans ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guest_scans (
  id BIGSERIAL PRIMARY KEY,
  ip_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scan Sessions (Ephemeral) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS scan_sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT,
  resume_text TEXT NOT NULL,
  resume_file_path TEXT,
  resume_mimetype TEXT,
  file_name TEXT,
  jd_text TEXT DEFAULT '',
  job_url TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  company_name TEXT DEFAULT '',
  credit_balance INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Express Sessions (connect-pg-simple) ───────────────────────

CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ── Download History ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS download_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id BIGINT REFERENCES scans(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  format TEXT NOT NULL DEFAULT 'pdf',
  type TEXT NOT NULL DEFAULT 'resume',
  watermarked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Stripe Event Idempotency (§8.2) ──────────────────────────

CREATE TABLE IF NOT EXISTS stripe_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_resume ON scans(resume_id);
CREATE INDEX IF NOT EXISTS idx_scans_access_token ON scans(access_token);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_cover_letters_user ON cover_letters(user_id);
CREATE INDEX IF NOT EXISTS idx_guest_scans_ip ON guest_scans(ip_address);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_stripe ON credit_transactions(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_scan_sessions_created ON scan_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_download_history_user ON download_history(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_event_id ON stripe_events(event_id);
