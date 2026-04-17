# ResumeXray — Premium ATS Intelligence Platform

ResumeXray is a production-grade career tool that reverse-engineers ATS parsers (Workday, Taleo, Lever) to reveal exactly how they see and score your resume. Built with FAANG-standard architecture: PostgreSQL, PM2 cluster mode, Caddy reverse proxy, and AI-powered optimization.

## 🚀 Key Features

- **ATS X-Ray Emulator:** Visualizes raw stringified data as seen by backend parsers
- **Ghosting Predictor:** Identifies bullet points lacking metrics and numbers
- **Knockout Question Shield:** Flags experience gaps that trigger automated rejection
- **AI Bullet Optimizer:** One-click STAR method optimization (Free sandbox, export costs credits)
- **Cover Letter Generator:** AI-powered, tailored to each job description
- **Credit System:** Stripe-powered one-time credit purchases (no subscriptions)

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 22 LTS, Express 4, PM2 Cluster |
| **Database** | SQLite (dev) / PostgreSQL via Supabase (prod) |
| **Auth** | Passport.js (Google, GitHub, LinkedIn OAuth + email/password) |
| **Frontend** | Vanilla JS SPA served from `public/` |
| **AI** | Google Gemini / OpenAI (dual-provider) |
| **Payments** | Stripe Checkout (credit packs) |
| **Reverse Proxy** | Caddy (auto-TLS, HSTS preload) |
| **Security** | Helmet CSP, CSRF tokens, rate limiting (6-tier), fail2ban |

---

## 💻 Local Development

```bash
# 1. Clone & install
git clone https://github.com/yourorg/ats-resume-checker.git
cd ats-resume-checker
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set SESSION_SECRET and GEMINI_API_KEY

# 3. Run (SQLite, auto-migrates)
npm run dev
```

The app starts at `http://localhost:3000`. Database schema is applied automatically on first boot.
There is no separate frontend bundler anymore; the live SPA is served directly from `public/`.

### Local Troubleshooting

- If you switch Node versions and hit a native-module error from `better-sqlite3`, run:

```bash
npm rebuild better-sqlite3
```

- If you want a clean local boot without depending on Upstash, blank the Redis URL so the app falls back to the in-memory limiter store:

```bash
UPSTASH_REDIS_URL= npm run dev
```

### Frontend Source Of Truth

- `public/index.html` is the SPA shell and route view markup
- `public/js/app.js` is the active SPA coordinator, boot path, and feature orchestrator
- `public/js/modules/ui-helpers.mjs` owns shared UI helpers like toasts, sanitization, escaping, and copy helpers
- `public/js/modules/pdf-preview.mjs` owns PDF preview state, controls, and iframe/blob preview loading
- `public/css/styles.css` is the active stylesheet
- `server.js` serves the SPA directly from `public/`

The previous modular `src/` frontend was removed to avoid split ownership. If we ever revisit a migration, it should happen in a dedicated branch with an explicit contract and rollout plan.

This frontend now uses a small native-ES-module "strangler fig" split inside `public/js/modules/` while keeping `public/js/app.js` as the stable orchestration layer. `npm run syntax:frontend` verifies both the main SPA file and the extracted modules.

### Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | ✅ | 64-byte hex (`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key |
| `GOOGLE_CLIENT_ID` | OAuth | Google OAuth credentials |
| `STRIPE_SECRET_KEY` | Payments | Stripe API key |
| `DB_ENGINE` | Prod | `sqlite` (default) or `pg` |
| `DATABASE_URL` | Prod | PostgreSQL connection string |

See [`.env.example`](.env.example) for the full list.

---

## 🚢 Production Deployment

### Prerequisites
- **VPS:** 2 vCPU / 8 GB RAM (Hostinger KVS 2 recommended)
- **Node.js 22 LTS** (see `.nvmrc`)
- **PostgreSQL:** Supabase free tier
- **Redis:** Upstash free tier (for PM2 cluster rate limiting)

### Deploy

```bash
# 1. Server provisioning (run once)
sudo bash deploy/ufw-setup.sh      # Firewall
sudo bash deploy/swap-setup.sh     # 2GB swap
sudo cp deploy/resumexray.service /etc/systemd/system/
sudo systemctl enable resumexray

# 2. Application deploy (zero-downtime)
bash deploy/deploy.sh
```

### Architecture

```
Internet → Cloudflare (WAF/CDN) → Caddy (TLS/HSTS) → PM2 (2 workers) → Express
                                                                          ↓
                                                              PostgreSQL (Supabase)
                                                              Redis (Upstash)
```

### Health Checks

| Endpoint | Purpose | Used By |
|----------|---------|---------|
| `GET /healthz` | Liveness (< 10ms) | PM2, Cloudflare |
| `GET /readyz` | Readiness (DB + Redis) | Load balancer |
| `GET /health` | Full diagnostic (memory, CPU, connections) | Dashboards |
| `GET /metrics` | Prometheus text format (localhost only) | node-exporter |

---

## 🔒 Security

- **CSP:** Nonce-based `script-src` with `strict-dynamic`, no `unsafe-eval`
- **Session:** `__Host-` cookie prefix, `httpOnly`, `sameSite: lax`, 2h idle + 8h absolute timeout
- **CSRF:** Synchronizer token pattern with timing-safe comparison
- **Rate Limiting:** 6-tier (general, auth, API, AI, agent, download) with Redis-backed store
- **Upload Validation:** MIME + extension + magic bytes + 5MB limit
- **Password Policy:** 8+ chars with digit (NIST 800-63B)
- **Account Lockout:** 10 failed attempts → 30 min block
- **Input Sanitization:** `sanitize-html` with empty allowlist on all user text

### Infrastructure Security
- UFW firewall (default deny, SSH rate-limited)
- fail2ban (SSH + custom auth filter)
- systemd hardening (NoNewPrivileges, ProtectSystem=strict, PrivateTmp)
- Body size limits (200KB JSON/URL-encoded)

---

## 📁 Project Structure

```
├── server.js              # Express app + graceful shutdown
├── config/
│   ├── passport.js        # OAuth + session serialization (async)
│   ├── security.js        # Helmet, CSP, rate limiters, sanitizer
│   └── stripe.js          # Credit packs + checkout
├── db/
│   ├── database.js        # SQLite adapter (54 functions)
│   ├── pg-database.js     # PostgreSQL adapter (54 functions, identical interface)
│   └── schema.sql         # Base schema
├── deploy/
│   ├── deploy.sh          # Zero-downtime deploy + health check rollback
│   ├── resumexray.service # systemd unit
│   ├── ufw-setup.sh       # Firewall
│   ├── swap-setup.sh      # Swap config
│   └── jail.local         # fail2ban
├── lib/                   # Business logic (parser, analyzer, LLM, mailer)
├── middleware/             # Auth, CSRF, upload, usage tracking
├── routes/                # API, auth, billing, AI, agent, user
├── public/                # Active SPA frontend (HTML, CSS, JS)
├── Caddyfile              # Reverse proxy config
└── ecosystem.config.js    # PM2 cluster config
```

---

## 📄 License

Proprietary. All rights reserved.
