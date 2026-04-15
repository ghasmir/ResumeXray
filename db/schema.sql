-- ResumeXray Database Schema
-- SQLite with strict typing

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  linkedin_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  email_hash TEXT UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  avatar_url TEXT,
  tier TEXT DEFAULT 'free' CHECK(tier IN ('free','starter','pro','hustler')),
  credit_balance INTEGER DEFAULT 1 CHECK(credit_balance >= 0),
  stripe_customer_id TEXT UNIQUE,
  scans_used INTEGER DEFAULT 0,
  ai_credits_used INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  email_verified_at TEXT,
  verification_token TEXT,
  verification_token_expires TEXT,
  reset_password_token TEXT,
  reset_password_expires TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('purchase', 'scan', 'ai_fix', 'export', 'signup_bonus', 'refund', 'cover_letter_export')),
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK(file_type IN ('pdf', 'docx')),
  file_size INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  parsed_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  resume_id INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
  access_token TEXT,
  job_description TEXT,
  job_url TEXT,
  job_title TEXT,
  company_name TEXT,
  ats_platform TEXT,
  job_context TEXT,
  parse_rate REAL,
  format_health REAL,
  match_rate REAL,
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
  render_meta TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  status TEXT DEFAULT 'saved' CHECK(status IN ('saved','applied','interview','offer','rejected','withdrawn')),
  notes TEXT,
  applied_at TEXT,
  deadline TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  location TEXT,
  remote TEXT CHECK(remote IN ('onsite','hybrid','remote')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cover_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,
  title TEXT,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guest_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_resume ON scans(resume_id);
CREATE INDEX IF NOT EXISTS idx_scans_access_token ON scans(access_token);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_cover_letters_user ON cover_letters(user_id);
CREATE INDEX IF NOT EXISTS idx_guest_scans_ip ON guest_scans(ip_address);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_stripe ON credit_transactions(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
CREATE INDEX IF NOT EXISTS idx_users_reset_password_token ON users(reset_password_token);
CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);
CREATE INDEX IF NOT EXISTS idx_scans_user_created ON scans(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created ON credit_transactions(user_id, created_at);
