# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Three-tier health checks: `/healthz` (liveness), `/readyz` (readiness), `/health` (diagnostic)
- Prometheus-compatible `/metrics` endpoint (localhost-only)
- `Server-Timing` headers on all responses for DevTools performance breakdown
- SSE backpressure via `res.write` drain events (prevents server OOM)
- SSE `id:` field for reconnect support via `Last-Event-ID`
- SSE concurrent stream limit (2 per user) + 15s heartbeat + 5-minute max lifetime
- Account lockout defense (10 failed attempts per 15 min → 30 min block)
- Session fixation protection (session regeneration on OAuth callback)
- Self-hosted Inter font (3 weights, woff2 format) — eliminates Google Fonts CDN dependency
- Branded 404 handler (API returns JSON, SPA routes serve index.html)
- `.nvmrc` + `engines` field in package.json (Node 22 LTS)
- `llms.txt` spec file for AI search engine discovery
- `security.txt` (RFC 9116) at `/.well-known/security.txt`
- Input length validation on scan routes (50K chars JD, 2048 URL)
- Stripe event idempotency functions for PostgreSQL
- PG `statement_timeout` (5s) and Redis `commandTimeout` (200ms)
- `setStripeCustomerId` helper in both DB adapters
- `getUserByEmail`, `createUser`, `claimGuestScans` helpers in both DB adapters
- Email format + length validation on signup (RFC 5322 simplified)
- Name length guard (100 chars max)
- Avatar content-type validation (JPEG/PNG/WebP only)
- 413 error handler for oversized payloads
- Caddyfile: reverse proxy, auto-TLS, HSTS preload, gzip/zstd, health checks, JSON logs
- systemd service unit with NoNewPrivileges, ProtectSystem=strict, PrivateTmp
- `.env.example`: documented `DB_ENGINE` toggle and `PII_ENCRYPTION_KEY`

### Changed
- PG pool `max` reduced from 20 → 6 (safe for 2-worker PM2 on Supabase free tier)
- PM2 ecosystem: 2 instances, 750MB restart, `--max-old-space-size=700`, exponential backoff
- CSP tightened: removed `fonts.googleapis.com` and `fonts.gstatic.com` from allowed sources
- Stripe webhook handler fully async with proper `await` on all DB calls
- Webhook returns 200 even on handler errors (prevents Stripe retry storms)
- Password policy: 8 chars minimum + at least one digit (NIST 800-63B)
- Trust proxy moved before session/rate-limiter middleware, always-on
- Body size limits: 200KB for JSON + URL-encoded payloads
- Passport.js: `deserializeUser` + all OAuth strategy callbacks are now `async`

### Fixed
- **67 missing `await` calls** across 8 files — prevented silent data loss in PG mode
- Stripe webhook used synchronous SQLite `.prepare().run()` — breaks in PG mode
- Webhook `setStripeCustomerId` used raw `pool.query` — breaks in SQLite mode
- `auth.js` used 4 raw `db.getDb().prepare()` calls — breaks in PG mode
- `user.js` had 17 sync DB calls — `/me`, `/dashboard`, `/account` all broken in PG
- `passport.js` `deserializeUser` returned Promise object as user — broke ALL auth in PG
- `session.regenerate` callback not async — `await` caused SyntaxError
- Missing `placeholders` variable after refactoring guest scan claiming

### Security
- Session cookie uses `__Host-` prefix in production (requires Secure + Path=/ + no Domain)
- Cookie: `httpOnly: true`, `sameSite: 'lax'`, 2h idle + 8h absolute timeout
- CSP nonce-based `script-src` with `strict-dynamic`
- `Permissions-Policy` denies all powerful features except `payment`, `fullscreen`, `clipboard-write`
- Upload validation: MIME + extension + magic bytes + 5MB limit
- `sanitize-html` with empty allowlist on all user text input
- Rate limiting: 6-tier with Redis-backed store in production
- `.gitignore` hardened: `.env.*` variants, PM2 logs, Sentry, backups

### Infrastructure
- Production Caddyfile with auto-TLS, Brotli, Cloudflare IP forwarding
- Hardened systemd unit (NoNewPrivileges, ProtectSystem=strict, 4GB MemoryMax)
- UFW firewall script (default deny, explicit allow)
- fail2ban rules for SSH + login endpoint
- 2GB swap setup script (swappiness=10)
- tmpfs RAM-backed upload directory (500MB, noexec, nosuid)
- Zero-downtime deploy script with health check rollback
- logrotate configuration (daily, 14-day retention, 50MB max)
- package.json v2.8.0 with production scripts (`npm run prod/reload/logs/syntax/healthz`)
- README comprehensive rewrite with architecture, security, and deployment docs

### Fixed (Tier 7-11)
- **P0 #13**: `emitComplete` sent `[object Promise]` as creditBalance instead of actual number
- `purgeExpiredScanSessions` not awaited in setInterval — silent failure in PG mode
- CSS cache-bust version mismatch: preload v=2.7 vs stylesheet v=2.6 → both v=2.8
- Bcrypt cost factor inconsistency: user.js used 10, auth.js used 12 → standardized to 12
- Account deletion now destroys session + clears cookie (was leaking stale sessions)
- GitHub OAuth CSRF exemption missing — GitHub login blocked
- Email validation added to forgot-password route
- Adapter parity: 54/54 functions match between SQLite and PostgreSQL

## [1.0.0] - 2026-03-28

### Added
- Initial release: ATS resume scanner with AI analysis pipeline
- PDF/DOCX/DOC/TXT file upload and parsing
- 9-step AI analysis agent with SSE progress streaming
- Google OAuth + email/password authentication
- Credit-based monetization with Stripe Checkout
- Resume optimization: AI bullet rewrites, keyword planning
- Cover letter generation
- Job tracker board
- Comprehensive SPA with dark mode UI
