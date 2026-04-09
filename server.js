require('dotenv').config();
// §10.x: Sentry must init BEFORE express is imported for auto-instrumentation
const { initSentryEarly } = require('./lib/error-tracker');
initSentryEarly();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
// ── Phase 5 §3: Session Store Strategy Toggle ────────────────────────────────
const DB_ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();
const isPg = DB_ENGINE === 'postgresql' || DB_ENGINE === 'postgres' || DB_ENGINE === 'pg';
let SessionStore;
if (isPg) {
  SessionStore = require('connect-pg-simple')(session);
} else {
  SessionStore = require('better-sqlite3-session-store')(session);
}
const { getDb, closeDb } = require('./db/database');
const { configurePassport } = require('./config/passport');
const { configureHelmet, generalLimiter, cspNonceMiddleware } = require('./config/security');
const { AppError } = require('./lib/errors');
const log = require('./lib/logger');
const { initSentry, flushSentry } = require('./lib/error-tracker');

// ── Fail-Fast: Validate Critical Environment Variables ────────────────────────
// Google Engineering Standard: Applications MUST crash on startup if critical
// configuration is missing, not silently use insecure defaults.
if (process.env.NODE_ENV === 'production') {
  const required = ['SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    log.fatal('Missing required environment variables', { missing });
    process.exit(1);
  }
}

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// §14.2: Trust first proxy (Cloudflare/Caddy) — MUST be set before session/rate-limiter.
// Without this, req.ip = Cloudflare's IP, breaking per-IP rate limits and audit trails.
app.set('trust proxy', 1);

// §10.x: Sentry error tracking — must be initialized before routes
initSentry(app);

// Setup Database & Error Handling
const db = getDb();
const { closeBrowser } = require('./lib/playwright-browser');

// Phase 6 Wave 2: Store HTTP server reference for graceful shutdown
let httpServer = null;

// Phase 6 Wave 2: Track active SSE connections for drain
const activeConnections = new Set();

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
// Phase 6 Wave 2: Proper drain sequence:
//   1. Stop accepting new connections (server.close)
//   2. Force-close idle keep-alive connections
//   3. Wait for in-flight requests to finish (up to 25s)
//   4. Close browser, Redis, database
//   5. Exit
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return; // Prevent double shutdown
  isShuttingDown = true;
  log.info('Shutdown signal received — draining connections', { signal });

  // Step 1: Stop accepting new connections
  if (httpServer) {
    httpServer.close(() => {
      log.info('HTTP server closed — no new connections');
    });
  }

  // Step 2: Force-close idle keep-alive connections
  for (const conn of activeConnections) {
    conn.destroy();
  }

  // Step 3: Give in-flight requests up to 25s to finish
  // (PM2 kill_timeout is 30s, so we need headroom)
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 4: Close external resources
  try { await flushSentry(); } catch {}
  try { await closeBrowser(); } catch {}
  try { const { closeRedis } = require('./lib/redis'); await closeRedis(); } catch {}
  try { await closeDb(); } catch {}

  log.info('Graceful shutdown complete', { signal });
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ── Unhandled Error Safety Nets ───────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
process.on('uncaughtException', (err) => {
  log.fatal('Uncaught exception — shutting down', {
    error: err.message,
    stack: err.stack,
  });
  gracefulShutdown('uncaughtException');
});

// Phase 6 Wave 2: Request ID middleware — assigns unique ID for log correlation
// Enables tracing a single request across all log lines (handlers, DB, LLM calls)
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Phase 6 Wave 2: Request/Response logging for observability
// Logs method, path, status, and duration for every request
app.use((req, res, next) => {
  // Skip noisy health checks and static assets in dev
  const skip = req.path === '/health' || req.path.startsWith('/js/') ||
               req.path.startsWith('/css/') || req.path.startsWith('/img/') ||
               req.path.startsWith('/fonts/');

  if (!skip) {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log[level](`${req.method} ${req.path}`, {
        requestId: req.id,
        status: res.statusCode,
        duration: `${duration}ms`,
        userId: req.user?.id,
        ip: req.ip,
      });
    });
  }
  next();
});

// §1.2: Server-Timing headers — visible in Chrome DevTools Network tab without APM
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const origWriteHead = res.writeHead;
  res.writeHead = function(statusCode, ...rest) {
    const ns = Number(process.hrtime.bigint() - start);
    const ms = (ns / 1e6).toFixed(1);
    // Inject Server-Timing before headers flush
    if (!res.getHeader('Server-Timing')) {
      res.setHeader('Server-Timing', `total;dur=${ms}`);
    }
    return origWriteHead.call(this, statusCode, ...rest);
  };
  next();
});

// Phase 6 Wave 2: Return 503 during shutdown — prevents new work from starting
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ error: 'Server is shutting down. Please retry.' });
  }
  next();
});

// Phase 3 #15: CSP Nonce — must run BEFORE helmet so nonce is available
app.use(cspNonceMiddleware);

// Configure Security
app.use(configureHelmet());
app.use(generalLimiter);

// Stripe Webhook needs raw body — must be registered BEFORE express.json()
const billingRoutes = require('./routes/billing');
app.use('/billing/webhook', require('body-parser').raw({ type: 'application/json' }));

// §10.11: Parse JSON/URL bodies with explicit size limits (prevents resource exhaustion)
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

// Setup Session Management — Hardened per OWASP recommendations
const SESSION_IDLE_MS  = 2 * 60 * 60 * 1000;   // 2 hours idle timeout
const SESSION_ABS_MS   = 8 * 60 * 60 * 1000;   // 8 hours absolute max lifetime

// Phase 6 §10.7: __Host- cookie prefix — forces Secure + Path=/ + no Domain.
// Prevents cookie tossing from subdomains. Only applied in production (requires HTTPS).
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_NAME = isProd ? '__Host-rxsid' : '__rxsid';

// ── Phase 5 §3: Session Store Configuration ──────────────────────────────────
let storeConfig;
if (isPg) {
  storeConfig = new SessionStore({
    pool: getDb(),              // pg.Pool instance from pg-database.js
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 900,  // Purge expired sessions every 15 min (seconds)
  });
} else {
  storeConfig = new SessionStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 900000        // Purge every 15 min (milliseconds)
    }
  });
}

app.use(session({
  store: storeConfig,
  name: COOKIE_NAME,     // Phase 6 §10.7: __Host- in prod, __rxsid in dev
  secret: process.env.SESSION_SECRET || 'fallback-secret-development-only',
  resave: true,          // Required for rolling sessions
  saveUninitialized: false,
  rolling: true,         // Resets idle timer on every response (sliding expiration)
  cookie: {
    secure: isProd,      // __Host- requires Secure (HTTPS only)
    httpOnly: true,      // Block JS access to cookie (XSS mitigation)
    sameSite: 'lax',     // CSRF mitigation for cross-site navigation
    maxAge: SESSION_IDLE_MS,
    path: '/',           // __Host- requires explicit Path=/
    // Domain intentionally omitted — __Host- forbids Domain attribute
  }
}));

// ── Absolute Session Timeout Middleware ─────────────────────────
// Prevents indefinite session extension via sliding expiration.
// Even if a user is continuously active, session expires after 8 hours.
app.use((req, res, next) => {
  if (req.session) {
    if (!req.session._createdAt) {
      req.session._createdAt = Date.now();
    }
    const age = Date.now() - req.session._createdAt;
    if (age > SESSION_ABS_MS) {
      return req.session.destroy((err) => {
        if (err) log.error('Session destroy error', { error: err.message });
        res.clearCookie(COOKIE_NAME);
        // For API requests return 401, for page requests redirect
        if (req.xhr || req.path.startsWith('/api') || req.path.startsWith('/user') ||
            req.path.startsWith('/ai') || req.path.startsWith('/billing')) {
          return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }
        return res.redirect('/login');
      });
    }
  }
  next();
});

// Setup Passport
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

// Serve static files — 1-day cache with ETag revalidation.
// Avoids the 1-year stale cache problem where deploys don't update user's CSS/JS.
app.use(express.static(path.join(__dirname, 'public'), {
  index: false, // SPA routes handle '/' so nonce can be injected into <script> tags
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // HTML files should never be cached (SPA routes)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // XML/TXT files (sitemap, robots) — cache for 1 hour
    if (filePath.endsWith('.xml') || filePath.endsWith('.txt')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// ── SEO: Explicit sitemap and robots routes ───────────────────
// Ensures correct Content-Type for crawlers
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// Phase 4 #20: CSRF Protection — Synchronizer Token Pattern
const { csrfProtection, getCsrfToken } = require('./middleware/csrf');

// CSRF token endpoint — frontend fetches this on load
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: getCsrfToken(req) });
});

// Apply CSRF protection to all state-changing requests
app.use(csrfProtection);

// Basic user info middleware for frontend rendering
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

// Routes
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// --- Frontend SPA Routes ---
// The following routes will serve the index.html SPA
// The frontend JS will handle actual rendering based on the URL
const spaRoutes = [
  '/', '/login', '/signup', '/dashboard', '/scan', '/results/:id', '/agent-results',
  '/resumes', '/jobs', '/ai-tools', '/pricing', '/settings', '/profile',
  '/forgot-password', '/verify/:token', '/reset-password/:token',
  '/privacy', '/terms'
];

// Phase 3 #15: Read index.html once, inject CSP nonce on each request
const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let indexHtmlTemplate = null;

spaRoutes.forEach(route => {
  app.get(route, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Robots-Tag', 'index, follow');
    
    // Lazy-load template (cached in prod, fresh in dev)
    if (!indexHtmlTemplate || process.env.NODE_ENV !== 'production') {
      indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf-8');
    }
    
    // Inject nonce into external script tags (not JSON-LD which is type="application/ld+json")
    const nonce = res.locals.cspNonce;
    const html = indexHtmlTemplate
      .replace(/<script(?![^>]*type=["']application\/ld\+json["'])/gi, `<script nonce="${nonce}"`);
    
    res.type('html').send(html);
  });
});

// API Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

const aiRoutes = require('./routes/ai');
app.use('/ai', aiRoutes);

const agentRoutes = require('./routes/agent');
app.use('/api/agent', agentRoutes);

app.use('/billing', billingRoutes);

const userRoutes = require('./routes/user');
app.use('/user', userRoutes);

// §3.6: Three-tier health checks (Google SRE standard)
const startTime = Date.now();

// Liveness — <10ms, no dependencies. PM2 + Cloudflare use this.
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

// Readiness — checks Postgres + Redis. Load balancer uses this.
app.get('/readyz', async (req, res) => {
  const checks = { postgres: false, redis: false };
  try {
    // Postgres check
    const dbCheck = getDb();
    if (isPg) {
      await dbCheck.query('SELECT 1');
    } else {
      dbCheck.prepare('SELECT 1').get();
    }
    checks.postgres = true;
  } catch {}
  try {
    // Redis check (optional — may not be configured)
    const { getRedis } = require('./lib/redis');
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      checks.redis = true;
    } else {
      checks.redis = 'not_configured';
    }
  } catch {
    checks.redis = false;
  }
  const ready = checks.postgres; // Redis is optional
  res.status(ready ? 200 : 503).json({ ready, checks });
});

// Full diagnostic — dashboards, manual inspection
app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.round((Date.now() - startTime) / 1000),
    pid: process.pid,
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1048576) + 'MB',
      heapTotal: Math.round(mem.heapTotal / 1048576) + 'MB',
      rss: Math.round(mem.rss / 1048576) + 'MB',
      external: Math.round(mem.external / 1048576) + 'MB',
    },
    cpu: {
      user: Math.round(cpu.user / 1000) + 'ms',
      system: Math.round(cpu.system / 1000) + 'ms',
    },
    connections: activeConnections.size,
    dbEngine: isPg ? 'postgresql' : 'sqlite',
    version: process.env.npm_package_version || '2.8.0',
    node: process.version,
  });
});

// §11.2: Prometheus text metrics — bind to localhost only via middleware
app.get('/metrics', (req, res) => {
  // Security: only accessible from localhost (scraped by node-exporter)
  const ip = req.ip || req.connection.remoteAddress;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return res.status(403).send('Forbidden');
  }
  const mem = process.memoryUsage();
  const metrics = [
    `# HELP nodejs_heap_used_bytes Node.js heap used`,
    `# TYPE nodejs_heap_used_bytes gauge`,
    `nodejs_heap_used_bytes ${mem.heapUsed}`,
    `# HELP nodejs_rss_bytes Resident set size`,
    `# TYPE nodejs_rss_bytes gauge`,
    `nodejs_rss_bytes ${mem.rss}`,
    `# HELP nodejs_uptime_seconds Process uptime`,
    `# TYPE nodejs_uptime_seconds gauge`,
    `nodejs_uptime_seconds ${Math.round(process.uptime())}`,
    `# HELP http_active_connections Active HTTP connections`,
    `# TYPE http_active_connections gauge`,
    `http_active_connections ${activeConnections.size}`,
    `# HELP nodejs_eventloop_lag_seconds Event loop lag`,
    `# TYPE nodejs_eventloop_lag_seconds gauge`,
    `nodejs_eventloop_lag_seconds 0`,
  ].join('\n') + '\n';
  res.type('text/plain; version=0.0.4; charset=utf-8').send(metrics);
});

// Phase 6 Wave 4: CSP violation reporting endpoint
// Receives browser reports when CSP blocks a resource — critical for auditing
app.post('/api/csp-report', express.json({ type: ['application/csp-report', 'application/json'] }), (req, res) => {
  const report = req.body?.['csp-report'] || req.body;
  if (report) {
    log.warn('CSP violation', {
      blockedUri: report['blocked-uri'] || report.blockedURL,
      directive: report['violated-directive'] || report.effectiveDirective,
      documentUri: report['document-uri'] || report.documentURL,
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
    });
  }
  res.status(204).end();
});

// Phase 6 Wave 4: Client-side error reporting
// Receives window.onerror and unhandledrejection events from the browser
app.post('/api/client-error', express.json(), (req, res) => {
  const { message, source, line, column, stack, type } = req.body || {};
  if (message) {
    log.warn('Client-side error', {
      message: typeof message === 'string' ? message.substring(0, 500) : 'unknown',
      source: typeof source === 'string' ? source.substring(0, 200) : undefined,
      line, column, type,
      userId: req.user?.id,
      requestId: req.id,
    });
  }
  res.status(204).end();
});

// Phase 6 §10.5: Responsible disclosure contact (RFC 9116)
app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'security.txt'));
});



// §13.9: Branded 404 — separate handling for API vs HTML requests
// API routes get proper JSON 404; HTML routes get the SPA shell for client-side routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/billing/')) {
    return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  }
  // SPA: serve index.html for all other routes — client-side router handles 404 page
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Centralized Error Handler ─────────────────────────────────────────────────
// Google Engineering Standard: Single error handler that:
// 1. Distinguishes operational errors (expected) from programmer bugs
// 2. Returns standardized JSON responses
// 3. Never leaks stack traces or internal details in production
// 4. Logs all errors with full context for debugging
app.use((err, req, res, next) => {
  // §10.11: Clean 413 for oversized payloads
  if (err.type === 'entity.too.large') {
    log.warn('Payload too large', { path: req.path, method: req.method, limit: err.limit });
    return res.status(413).json({ error: 'Request body too large.', code: 'PAYLOAD_TOO_LARGE' });
  }

  // Determine if this is a known application error
  if (err instanceof AppError) {
    // Operational error — log at appropriate level and return safe response
    if (err.statusCode >= 500) {
      log.error(err.message, { code: err.code, statusCode: err.statusCode, path: req.path });
    } else {
      log.warn(err.message, { code: err.code, statusCode: err.statusCode, path: req.path });
    }
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Unknown/programmer error — log full stack, return opaque message
  log.error('Unhandled server error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: isProd ? 'Internal Server Error' : err.message,
    code: 'INTERNAL_ERROR',
    ...(isProd ? {} : { stack: err.stack }),
  });
});

// Start Server
httpServer = app.listen(PORT, () => {
  log.info(`ResumeXray running at http://localhost:${PORT}`, { port: PORT });
  // Phase 6 Wave 2: Signal PM2 that the server is ready (for wait_ready + graceful reload)
  if (typeof process.send === 'function') process.send('ready');

  // Phase 6 Wave 2: Startup cleanup — purge stale temp uploads from previous runs
  const TMP_DIR = path.join(__dirname, 'tmp_uploads');
  if (fs.existsSync(TMP_DIR)) {
    try {
      const files = fs.readdirSync(TMP_DIR);
      const now = Date.now();
      let cleaned = 0;
      for (const file of files) {
        const filePath = path.join(TMP_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          // Remove files older than 1 hour
          if (now - stat.mtimeMs > 3600000) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch {}
      }
      if (cleaned > 0) log.info('Cleaned stale temp files', { count: cleaned });
    } catch (err) {
      log.warn('Temp cleanup failed', { error: err.message });
    }
  }
});

// Phase 6 Wave 2: Track connections for graceful drain
httpServer.on('connection', (conn) => {
  activeConnections.add(conn);
  conn.on('close', () => activeConnections.delete(conn));
});
