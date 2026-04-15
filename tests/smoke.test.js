/**
 * ResumeXray — E2E Smoke Tests
 *
 * Minimal test suite using Node.js built-in test runner (no dependencies).
 * Validates critical paths: health checks, auth gates, SPA routing, API errors.
 *
 * Usage:
 *   node --test tests/smoke.test.js
 *   npm test
 *
 * Boots a local server automatically unless TEST_URL is provided.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

let BASE = process.env.TEST_URL || '';
let serverProcess = null;

async function waitForServer(url, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start at ${url}`);
}

async function get(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...options,
  });
  return res;
}

before(async () => {
  if (BASE) return;

  const port = 3300 + Math.floor(Math.random() * 200);
  BASE = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  });
  serverProcess.unref();

  try {
    await waitForServer(BASE);
  } catch (error) {
    if (serverProcess) serverProcess.kill('SIGTERM');
    throw new Error(error.message);
  }
});

after(async () => {
  if (!serverProcess) return;
  await new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    serverProcess.once('exit', () => finish());
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      try {
        serverProcess.kill('SIGKILL');
      } catch {
        /* process already gone */
      }
      finish();
    }, 600);
  });
});

// ── Health Checks ──────────────────────────────────────────────────────────────

describe('Health Endpoints', () => {
  it('GET /healthz returns "ok"', async () => {
    const res = await get('/healthz');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'ok');
  });

  it('GET /readyz returns ready:true', async () => {
    const res = await get('/readyz');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ready, true);
  });

  it('GET /health returns version and dbEngine', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.version, 'version should exist');
    assert.ok(data.dbEngine, 'dbEngine should exist');
    assert.ok(data.pid, 'pid should exist');
  });
});

// ── SPA Routing ────────────────────────────────────────────────────────────────

describe('SPA Routing', () => {
  it('GET /scan returns 200 with HTML', async () => {
    const res = await get('/scan');
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type');
    assert.ok(ct.includes('text/html'), `Expected HTML, got ${ct}`);
  });

  it('GET /dashboard returns 200 with HTML', async () => {
    const res = await get('/dashboard');
    assert.equal(res.status, 200);
  });

  it('GET /pricing returns 200 with HTML', async () => {
    const res = await get('/pricing');
    assert.equal(res.status, 200);
  });
});

// ── API Error Handling ─────────────────────────────────────────────────────────

describe('API Error Handling', () => {
  it('GET /api/nonexistent returns 404 JSON', async () => {
    const res = await get('/api/nonexistent');
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.code, 'NOT_FOUND');
  });

  it('GET /auth/nonexistent returns 404 JSON', async () => {
    const res = await get('/auth/nonexistent');
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.code, 'NOT_FOUND');
  });
});

// ── Auth Gates ─────────────────────────────────────────────────────────────────

describe('Auth Gates', () => {
  it('GET /profile returns 200 (SPA serves index.html, auth checked client-side)', async () => {
    const res = await get('/profile');
    assert.equal(res.status, 200);
    // The actual authenticated data gate is /user/dashboard which returns 401
  });

  it('GET /user/dashboard returns 401 without session', async () => {
    const res = await get('/user/dashboard');
    assert.equal(res.status, 401);
  });
});

// ── Security Headers ──────────────────────────────────────────────────────────

describe('Security Headers', () => {
  it('Responses include X-Request-Id', async () => {
    const res = await get('/healthz');
    const rid = res.headers.get('x-request-id');
    assert.ok(rid, 'X-Request-Id should be present');
    assert.ok(rid.length > 10, 'X-Request-Id should be a UUID-like string');
  });

  it('Responses include Content-Security-Policy', async () => {
    const res = await get('/scan');
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'CSP header should be present');
    assert.ok(csp.includes("'self'"), 'CSP should include self');
  });

  it('Responses include X-Content-Type-Options: nosniff', async () => {
    const res = await get('/healthz');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('CSRF token endpoint returns token', async () => {
    const res = await get('/api/csrf-token');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token, 'CSRF token should be present');
  });
});

// ── Static Assets ──────────────────────────────────────────────────────────────

describe('Static Assets', () => {
  it('GET /css/styles.css returns 200', async () => {
    const res = await get('/css/styles.css');
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/css'));
  });

  it('GET /js/app.js returns 200', async () => {
    const res = await get('/js/app.js');
    assert.equal(res.status, 200);
  });

  it('GET /robots.txt returns 200', async () => {
    const res = await get('/robots.txt');
    assert.equal(res.status, 200);
  });
});
