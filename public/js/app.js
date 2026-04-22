// ═══════════════════════════════════════════════════════════════
// ResumeXray V4 — "See It. Fix It. Land It."
// Premium ATS Intelligence Platform
// ═══════════════════════════════════════════════════════════════

let currentUser = null;
let currentScan = null;
let lastJobInput = '';
let loadResultsToken = 0; // Cancellation token for loadResults retries
let userFetchPromise = null; // Request deduplication for fetchUser
const pdfPreviewState = {
  mode: window.innerWidth < 768 ? 'detailed' : 'standard',
  focusMode: false,
};
let currentJobContext = null;
let currentRenderProfile = null;
let jobContextProbeController = null;
let uiHelpers = null;
let pdfPreviewController = null;

const frontendModulesReady = Promise.all([
  import('/js/modules/ui-helpers.mjs'),
  import('/js/modules/pdf-preview.mjs'),
])
  .then(([uiModule, pdfPreviewModule]) => {
    uiHelpers = uiModule;
    pdfPreviewController = pdfPreviewModule.createPdfPreviewController({
      state: pdfPreviewState,
      clearPdfPreviewObjectUrl,
      getActiveScanId,
      currentScanTokenQuery,
      currentPreviewProfileQuery,
    });
  })
  .catch(error => {
    console.error('Failed to load frontend modules', error);
    throw error;
  });

// Clears the PDF canvas container. The pdfjs document is destroyed inside
// pdf-preview.mjs before each reload — this just resets visual state.
function clearPdfPreviewObjectUrl(_previewFrame) {
  // Legacy parameter kept for API compat — canvas container is in the DOM as #pdf-canvas-container
  const container = document.getElementById('pdf-canvas-container');
  if (container) container.innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS (Performance & Accessibility)
// ═══════════════════════════════════════════════════════════════

// Debounce function for performance optimization
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function uiIcon(name, { size = 18, stroke = 2 } = {}) {
  return uiHelpers?.uiIcon(name, { size, stroke }) || '';
}

// Screen reader announcement helper for accessibility
function announceToScreenReader(message, priority = 'polite') {
  if (uiHelpers) {
    uiHelpers.announceToScreenReader(message, priority);
  }
}

// Client-side error telemetry — sends to /api/client-error
(function initErrorReporting() {
  let errorCount = 0;
  const MAX_ERRORS = 5; // Throttle to prevent spam

  function reportError(payload) {
    if (errorCount >= MAX_ERRORS) return;
    errorCount++;
    try {
      navigator.sendBeacon('/api/client-error', JSON.stringify(payload));
    } catch {}
  }

  window.onerror = function (message, source, line, column, error) {
    reportError({ message, source, line, column, stack: error?.stack, type: 'onerror' });
  };

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason;
    reportError({
      message: reason?.message || String(reason),
      stack: reason?.stack,
      type: 'unhandledrejection',
    });
  });
})();

// ── Phase 4 #20: CSRF Token Management ──────────────────────────
let _csrfToken = null;

async function fetchCsrfToken() {
  try {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    _csrfToken = data.token;
  } catch {
    /* non-critical on first load */
  }
}

// Patch global fetch to auto-attach CSRF token on state-changing requests
const _originalFetch = window.fetch;
window.fetch = function (url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (_csrfToken && isMutating) {
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      options.headers.set('X-CSRF-Token', _csrfToken);
    } else {
      options.headers['X-CSRF-Token'] = _csrfToken;
    }
  }
  return _originalFetch.call(this, url, options).then(async res => {
    // Auto-retry once on CSRF failure: refetch token and replay the request
    if (res.status === 403 && isMutating && !options._csrfRetried) {
      const body = await res
        .clone()
        .json()
        .catch(() => null);
      if (body?.code?.startsWith('CSRF_TOKEN')) {
        await fetchCsrfToken();
        options._csrfRetried = true;
        if (options.headers instanceof Headers) {
          options.headers.set('X-CSRF-Token', _csrfToken);
        } else {
          options.headers['X-CSRF-Token'] = _csrfToken;
        }
        return _originalFetch.call(this, url, options);
      }
    }
    return res;
  });
};

// !! DO NOT call fetchCsrfToken() here — it races with fetchUser().
// The /user/me response auto-saves the session (rolling:true), overwriting
// the CSRF token. Instead, fetchCsrfToken() is called at the END of fetchUser().

// ── Helpers ───────────────────────────────────────────────────
function timeAgo(dateStr) {
  const now = Date.now();
  const d = new Date(dateStr).getTime();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

function scoreColor(score) {
  if (score >= 80) return 'var(--green)';
  if (score >= 50) return 'var(--amber)';
  return 'var(--red)';
}

function scoreBadge(score, label) {
  const s = Math.round(score || 0);
  const cls = s >= 80 ? 'score-badge-green' : s >= 50 ? 'score-badge-amber' : 'score-badge-red';
  return `<span class="score-badge ${cls}">${s}% ${label}</span>`;
}

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await frontendModulesReady;
  await fetchUser();
  setupRouter();
  setupGlobalDelegation();
  setupFileUpload();
  setupAuthForms();
  setupPasswordToggles();
  setupResultsTabs();
  setupPdfPreviewControls();
  setupMobileMenu();
  setupAgentResults();

  let path = window.location.pathname;
  if (path === '/' && currentUser) path = '/dashboard';
  navigateTo(path);
});

// ── Auth State ─────────────────────────────────────────────────
async function fetchUser() {
  // Request deduplication: return existing promise if already fetching
  if (userFetchPromise) return userFetchPromise;

  // Guard: if we just logged out, skip fetching to prevent stale session re-auth
  if (sessionStorage.getItem('rx_logged_out')) {
    sessionStorage.removeItem('rx_logged_out');
    currentUser = null;
    if (el('nav-user-area')) el('nav-user-area').style.display = 'none';
    if (el('nav-guest-area')) el('nav-guest-area').style.display = 'flex';
    if (el('nav-link-dashboard')) el('nav-link-dashboard').style.display = 'none';
    if (el('sheet-auth-area')) el('sheet-auth-area').style.display = 'none';
    if (el('sheet-guest-area')) el('sheet-guest-area').style.display = 'block';
    if (el('sheet-link-dashboard')) el('sheet-link-dashboard').style.display = 'none';
    return;
  }

  userFetchPromise = (async () => {
    try {
      const res = await fetch('/user/me');
      if (res.ok) {
        currentUser = await res.json();
        const user = currentUser.user || currentUser;

        // Update UI elements
        const initials = (user.name || 'U')
          .split(' ')
          .map(w => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        if (el('nav-avatar-initials')) el('nav-avatar-initials').textContent = initials;
        const avatarUrl = user.avatarUrl || user.avatar || null; // handle both field names
        if (avatarUrl && el('nav-avatar')) {
          // Safe avatar rendering — validate URL protocol before injection
          const safeUrl =
            avatarUrl.startsWith('https://') || avatarUrl.startsWith('/') ? avatarUrl : '';
          if (safeUrl) {
            const img = document.createElement('img');
            img.src = safeUrl;
            img.alt = user.name || 'User';
            el('nav-avatar').textContent = '';
            el('nav-avatar').appendChild(img);
          }
        }
        if (el('nav-credits-count')) el('nav-credits-count').textContent = user.creditBalance || 0;

        // Show/Hide areas — authenticated
        if (el('nav-user-area')) el('nav-user-area').style.display = 'flex';
        if (el('nav-guest-area')) el('nav-guest-area').style.display = 'none';
        if (el('nav-link-dashboard')) el('nav-link-dashboard').style.display = 'inline-flex';
        // Bottom sheet: show auth items, hide guest items
        if (el('sheet-auth-area')) el('sheet-auth-area').style.display = 'block';
        if (el('sheet-guest-area')) el('sheet-guest-area').style.display = 'none';
        if (el('sheet-link-dashboard')) el('sheet-link-dashboard').style.display = 'flex';

        // Update credit balance in navbar
        updateNavCredits(user.creditBalance || 0);
      } else {
        currentUser = null;
        if (el('nav-user-area')) el('nav-user-area').style.display = 'none';
        if (el('nav-guest-area')) el('nav-guest-area').style.display = 'flex';
        if (el('nav-link-dashboard')) el('nav-link-dashboard').style.display = 'none';
        if (el('sheet-auth-area')) el('sheet-auth-area').style.display = 'none';
        if (el('sheet-guest-area')) el('sheet-guest-area').style.display = 'block';
        if (el('sheet-link-dashboard')) el('sheet-link-dashboard').style.display = 'none';
      }
    } catch (e) {
      currentUser = null;
      if (el('nav-user-area')) el('nav-user-area').style.display = 'none';
      if (el('nav-guest-area')) el('nav-guest-area').style.display = 'flex';
      if (el('sheet-auth-area')) el('sheet-auth-area').style.display = 'none';
      if (el('sheet-guest-area')) el('sheet-guest-area').style.display = 'block';
    }
    // Fetch CSRF token AFTER /user/me has completed and session has been saved.
    // This guarantees our token is the last write — no overwrite from rolling session save.
    await fetchCsrfToken();
  })();

  try {
    return await userFetchPromise;
  } finally {
    userFetchPromise = null; // Reset for next call
  }
}

function updateNavCredits(balance) {
  const countEl = el('nav-credits-count');
  if (countEl) countEl.textContent = balance;

  const badge = el('nav-credits-badge');
  if (badge) {
    badge.title = `${balance} credits remaining`;
    badge.onclick = e => {
      e.stopPropagation();
      navigateTo('/pricing');
    };
  }
}

function el(id) {
  return uiHelpers?.el(id) || document.getElementById(id);
}

// Null-safe element wrapper — silently no-ops when element doesn't exist.
// Use $(id) instead of el(id) when the element might not be in the DOM.
function $(id) {
  const element = document.getElementById(id);
  if (element) return element;
  const noop = () => {};
  const noopEl = Object.create(null);
  noopEl.style = new Proxy({}, { set: () => true });
  noopEl.classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
  noopEl.dataset = {};
  noopEl.children = [];
  noopEl.parentNode = null;
  return new Proxy(noopEl, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return noop;
    },
    set() {
      return true;
    },
  });
}

// ── Auth Navigation Helper (used by guest unlock overlays) ──
function showAuth(mode) {
  navigateTo(mode === 'login' ? '/login' : '/signup');
}

// ── SPA Router ─────────────────────────────────────────────────
function setupRouter() {
  document.querySelectorAll('[data-link]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const href = e.target.closest('[href]');
      if (href) navigateTo(href.getAttribute('href'));
    });
  });
  window.addEventListener('popstate', () => navigateTo(location.pathname, false));
}

function getPageTitle(path) {
  if (path === '/') return 'ResumeXray — Free ATS Resume Scanner & Optimizer';
  if (path === '/signup') return 'Create Account — ResumeXray';
  if (path === '/login') return 'Log In — ResumeXray';
  if (path === '/dashboard') return 'Dashboard — ResumeXray';
  if (path === '/scan') return 'Analyze Your Resume — ResumeXray';
  if (path === '/pricing') return 'Pricing — ResumeXray';
  if (path === '/profile') return 'Your Profile — ResumeXray';
  if (path === '/agent-results') return 'Live Analysis — ResumeXray';
  if (path.startsWith('/verify/')) return 'Verify Email — ResumeXray';
  if (path === '/forgot-password') return 'Forgot Password — ResumeXray';
  if (path.startsWith('/reset-password/')) return 'Reset Password — ResumeXray';
  if (path.startsWith('/results/')) return 'Scan Results — ResumeXray';
  if (path === '/privacy') return 'Privacy Policy — ResumeXray';
  if (path === '/terms') return 'Terms of Service — ResumeXray';
  return 'Page Not Found — ResumeXray';
}

function getRouteGroup(path) {
  if (
    path === '/dashboard' ||
    path === '/profile' ||
    path === '/agent-results' ||
    path.startsWith('/results/')
  ) {
    return 'app';
  }
  if (
    path === '/login' ||
    path === '/signup' ||
    path === '/forgot-password' ||
    path.startsWith('/reset-password/') ||
    path.startsWith('/verify/')
  ) {
    return 'auth';
  }
  if (path === '/privacy' || path === '/terms') return 'legal';
  return 'marketing';
}

function navigateTo(path, push = true) {
  if (push) history.pushState({}, '', path);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // SPA focus management — move focus to active view's heading for screen readers
  requestAnimationFrame(() => {
    const activeView = document.querySelector('.view.active');
    if (activeView) {
      const heading = activeView.querySelector('h1, h2, h3');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: false });
      }
      window.scrollTo(0, 0);
    }
  });

  if (path === '/') {
    el('view-landing').classList.add('active');
  } else if (path === '/signup') {
    el('view-signup').classList.add('active');
  } else if (path === '/login') {
    el('view-login').classList.add('active');
  } else if (path === '/dashboard') {
    if (!currentUser) return navigateTo('/login');
    el('view-dashboard').classList.add('active');
    renderDashboard();
  } else if (path === '/scan') {
    el('view-scan').classList.add('active');
    resetScanForm();
  } else if (path === '/pricing') {
    el('view-pricing').classList.add('active');
    renderPricing();
  } else if (path === '/profile') {
    if (!currentUser) return navigateTo('/login');
    el('view-profile').classList.add('active');
    renderProfile();
  } else if (path === '/agent-results') {
    // Check for live stream data
    const timeline = el('agent-timeline');
    const isLive = timeline && timeline.children.length > 0;

    if (!isLive) {
      // No live stream — try to recover from localStorage
      const persistedId = localStorage.getItem('resumeXray_currentScanId');
      if (persistedId) {
        history.replaceState({}, '', `/results/${persistedId}`);
        loadResults(persistedId);
        return;
      }
      navigateTo('/scan');
      showToast('Scan expired. Please run a new scan.', 'info');
      return;
    }
    // Live scan always uses the unified view-results now
    el('view-results').classList.add('active');
  } else if (path.startsWith('/verify/')) {
    el('view-verify').classList.add('active');
    verifyEmail(path.split('/')[2]);
  } else if (path === '/forgot-password') {
    el('view-forgot-password').classList.add('active');
  } else if (path.startsWith('/reset-password/')) {
    el('view-reset-password').classList.add('active');
    const token = path.split('/')[2];
    el('reset-token').value = token;
  } else if (path.startsWith('/results/')) {
    // Don't activate any view — loadResults decides which view to show
    loadResults(path.split('/')[2]);
  } else if (path === '/privacy') {
    el('view-privacy').classList.add('active');
  } else if (path === '/terms') {
    el('view-terms').classList.add('active');
  } else {
    // 404 page for unknown routes instead of silently showing landing
    const view404 = el('view-404');
    if (view404) {
      view404.classList.add('active');
    } else {
      el('view-landing').classList.add('active');
    }
  }

  document.title = getPageTitle(path);
  document.body.dataset.routeGroup = getRouteGroup(path);

  // Scroll to top
  window.scrollTo(0, 0);

  // Update active nav link
  updateActiveNavLink(path);

  // Re-trigger fade-up animations in newly active view
  const activeView = document.querySelector('.view.active');
  if (activeView) {
    activeView.querySelectorAll('.animate-fade-up').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight; // force reflow
      el.style.animation = '';
    });
  }
}

function updateActiveNavLink(path) {
  document.querySelectorAll('#nav-links a').forEach(a => {
    const href = a.getAttribute('href');
    // Exact match for the link, or starts with if it's a subpath (optional)
    const isActive = path === href || (href !== '/' && path.startsWith(href));
    a.classList.toggle('active', isActive);
  });
}

function resetScanForm() {
  const form = el('scan-form');
  if (form) {
    form.reset();
    form.style.display = 'block';
  }
  const preview = el('file-preview');
  if (preview) preview.style.display = 'none';
  const area = el('upload-area');
  if (area) {
    area.style.display = '';
    area.classList.remove('file-selected');
  }
  el('scan-error').style.display = 'none';
  el('scan-loading').style.display = 'none';
  // Re-disable scan submit button until file is selected
  const submitBtn = el('scan-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
}

// ── Password Strength Validator (global helper) ───────────────
function _setupPasswordStrength(inputId, prefix) {
  const input = el(inputId);
  if (!input) return;
  // Prevent duplicate event bindings
  if (input.dataset.strengthBound) return;
  input.dataset.strengthBound = '1';

  const container = el(prefix + '-pw-strength');
  const meter = el(prefix + '-pw-meter');
  const rules = {
    length: el(prefix + '-rule-length'),
    number: el(prefix + '-rule-number'),
    upper: el(prefix + '-rule-upper'),
    special: el(prefix + '-rule-special'),
  };

  function checkPassword() {
    const pw = input.value;
    const checks = {
      length: pw.length >= 8,
      number: /\d/.test(pw),
      upper: /[A-Z]/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw),
    };

    let score = 0;
    for (const [key, passed] of Object.entries(checks)) {
      if (passed) score++;
      const ruleEl = rules[key];
      if (ruleEl) {
        ruleEl.classList.toggle('pass', passed);
        const icon = ruleEl.querySelector('.pw-rule-icon');
        if (icon) icon.textContent = passed ? '✓' : '○';
      }
    }

    if (meter) meter.setAttribute('data-strength', String(score));
    // Show the container when user starts typing
    if (container && pw.length > 0) container.classList.add('visible');
    return checks;
  }

  // Listen to all possible input events (type, paste, autofill) — debounced for performance
  const debouncedCheck = debounce(checkPassword, 100);
  ['input', 'keyup', 'change', 'paste'].forEach(evt => {
    input.addEventListener(evt, debouncedCheck);
  });

  input.addEventListener('focus', () => {
    if (container && input.value.length > 0) container.classList.add('visible');
  });

  // Expose for form submit validation
  input._checkStrength = checkPassword;
}

// ── Auth Forms ─────────────────────────────────────────────────
function setupAuthForms() {
  _setupPasswordStrength('signup-password', 'signup');
  _setupPasswordStrength('reset-new-password', 'reset');

  // Signup form
  const signupForm = el('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = el('signup-error');
      errEl.style.display = 'none';
      const name = el('signup-name').value.trim();
      const email = el('signup-email').value.trim();
      const password = el('signup-password').value;

      try {
        const res = await fetch('/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (data.error) {
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        } else {
          currentUser = data;
          await fetchUser();
          // Always go to scan page after signup — ready to run first scan
          localStorage.removeItem('resumeXray_currentScanId');
          navigateTo('/scan');
          // Show persistent nudge: verification email was sent
          setTimeout(() => {
            showToast(
              'Check your inbox to verify your email and unlock your free export credit.',
              'info',
              { duration: 8000 }
            );
          }, 600);
        }
      } catch {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
      }
    });
  }

  // Login form
  const loginForm = el('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = el('login-error');
      errEl.style.display = 'none';
      const email = el('login-email').value.trim();
      const password = el('login-password').value;

      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (data.error) {
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        } else {
          currentUser = data;
          await fetchUser();
          // Always go to dashboard after login — clean start
          localStorage.removeItem('resumeXray_currentScanId');
          navigateTo('/dashboard');
        }
      } catch {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
      }
    });
  }

  // Forgot password form
  const forgotForm = el('forgot-password-form');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = el('forgot-error');
      const succEl = el('forgot-success');
      errEl.style.display = 'none';
      succEl.style.display = 'none';
      const email = el('forgot-email').value.trim();

      try {
        const res = await fetch('/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (data.error) {
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        } else {
          succEl.style.display = 'block';
          forgotForm.reset();
        }
      } catch {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
      }
    });
  }

  // Reset password form
  const resetForm = el('reset-password-form');
  if (resetForm) {
    resetForm.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = el('reset-error');
      errEl.style.display = 'none';
      const token = el('reset-token').value;
      const password = el('reset-new-password').value;

      try {
        const res = await fetch('/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json();
        if (data.error) {
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        } else {
          showToast('Password updated! Redirecting to login...', 'success');
          setTimeout(() => navigateTo('/login'), 2000);
        }
      } catch {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
      }
    });
  }
}

async function verifyEmail(token) {
  try {
    const res = await fetch(`/auth/verify/${token}`);
    const data = await res.json();
    if (data.success) {
      showToast('Email verified successfully!', 'success');
      setTimeout(() => navigateTo(currentUser ? '/dashboard' : '/login'), 2000);
    } else {
      showToast(data.error || 'Verification failed', 'error');
      setTimeout(() => navigateTo('/'), 2000);
    }
  } catch {
    showToast('Unable to connect. Please check your internet and try again.', 'error');
  }
}

// ── Global Event Delegation ────────────────────────────────────
function setupGlobalDelegation() {
  document.body.addEventListener('click', e => {
    // Tab switching
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      switchTab(tabBtn.dataset.tab);
      return;
    }

    // Actions
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.preventDefault();
      const action = actionBtn.dataset.action;
      if (action === 'navigate') navigateTo(actionBtn.dataset.path);
      else if (action === 'checkout') startCheckout(actionBtn.dataset.plan);
      else if (action === 'manage-billing') openBillingPortal();
      else if (action === 'fix-bullet') fixBullet(actionBtn);
      else if (action === 'reload-pdf-preview' && actionBtn.dataset.scanId)
        reloadPdfPreview(actionBtn.dataset.scanId);
      else if (action === 'apply-fix-metric') {
        const fixIndex = parseInt(actionBtn.dataset.fixIndex || '', 10);
        if (Number.isInteger(fixIndex)) applyFixMetric(fixIndex);
      }
      return;
    }

    // Data-link clicks (for dynamically created links)
    const link = e.target.closest('[data-link]');
    if (link && link.hasAttribute('href')) {
      e.preventDefault();
      navigateTo(link.getAttribute('href'));
      return;
    }

    // Copy button via data-attribute (replaces inline onclick)
    const copyBtn = e.target.closest('[data-copy-text]');
    if (copyBtn) {
      e.preventDefault();
      copyToClipboard(copyBtn.dataset.copyText, copyBtn);
      return;
    }

    // Auth navigation via data-attribute (replaces inline onclick="showAuth(...)")
    const authBtn = e.target.closest('[data-auth]');
    if (authBtn) {
      e.preventDefault();
      showAuth(authBtn.dataset.auth);
      return;
    }

    // Step toggle via data-attribute (replaces inline onclick="toggleStepBody(...)")
    const stepToggle = e.target.closest('[data-toggle-step]');
    if (stepToggle) {
      e.preventDefault();
      toggleStepBody(parseInt(stepToggle.dataset.toggleStep, 10));
      return;
    }
  });

  const logoutBtn = el('nav-logout');
  const doLogout = async e => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

    // Set guard flag FIRST — prevents fetchUser from re-authenticating on reload
    try {
      sessionStorage.setItem('rx_logged_out', '1');
    } catch {}

    try {
      const res = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      try {
        await res.json();
      } catch {}
    } catch {
      /* proceed with client-side cleanup regardless */
    }

    currentUser = null;
    try {
      localStorage.removeItem('resumeXray_currentScanId');
    } catch {}

    // Force-hide authenticated UI immediately
    if (el('nav-user-area')) el('nav-user-area').style.display = 'none';
    if (el('nav-guest-area')) el('nav-guest-area').style.display = 'flex';
    if (el('nav-link-dashboard')) el('nav-link-dashboard').style.display = 'none';
    if (el('sheet-auth-area')) el('sheet-auth-area').style.display = 'none';
    if (el('sheet-guest-area')) el('sheet-guest-area').style.display = 'block';
    if (el('sheet-link-dashboard')) el('sheet-link-dashboard').style.display = 'none';

    // Hard reload to landing — guarantees clean state, no stale cookie race
    window.location.replace('/');
  };
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
  // Expose so the bottom-sheet handler can call the same code path directly
  window.__rxLogout = doLogout;
}

function switchTab(tabId) {
  if (tabId !== 'tab-pdf-preview' && tabId !== 'pdf-preview' && pdfPreviewState.focusMode) {
    setPdfPreviewFocusMode(false);
  }

  // Unified tab system: works with both old (.tab-content/.tab-btn) and new (.results-tab-pane/.results-tab-btn)
  document.querySelectorAll('.tab-content, .results-tab-pane').forEach(t => {
    t.classList.remove('active-tab');
    t.classList.remove('active');
  });
  document
    .querySelectorAll('.tab-btn, .results-tab-btn')
    .forEach(b => b.classList.remove('active'));

  // New HTML uses data-tab values that ARE the element IDs (e.g. "tab-diagnosis")
  // Old HTML uses data-tab values that need "tab-" prefix (e.g. "diagnosis" → "tab-diagnosis")
  let tab = document.getElementById(tabId) || el('tab-' + tabId);
  let btn = document.querySelector(`[data-tab="${tabId}"]`) || el('btn-' + tabId);

  if (tab) {
    tab.classList.add('active');
    tab.classList.add('active-tab');
    tab.setAttribute('role', 'tabpanel');
    // Ensure tabpanel is labeled by its tab button
    if (btn) {
      tab.setAttribute('aria-labelledby', btn.id || '');
    }
  }

  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    btn.setAttribute('tabindex', '0');
    // Focus the active tab for keyboard navigation
    btn.focus();
  }

  // Update aria-selected and tabindex on all tab buttons
  document.querySelectorAll('.results-tab-btn').forEach(b => {
    if (b !== btn) {
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('tabindex', '-1');
    }
  });

  // Trigger lazy-loading for PDF if switched to that tab
  if (tabId === 'tab-pdf-preview' || tabId === 'pdf-preview') {
    const bar = el('agent-download-bar');
    const scanId = getActiveScanId();

    if (scanId) {
      // Update the bar dataset if needed
      if (bar && !bar.dataset.scanId) {
        bar.dataset.scanId = String(scanId);
      }

      // Always reload on tab switch to ensure fresh content
      reloadPdfPreview(scanId);

      // Show the viewer overlay if it was hidden
      const viewOverlay = el('pdf-viewer-overlay');
      const scanOverlay = el('pdf-scanning-overlay');
      if (viewOverlay) viewOverlay.style.display = 'flex';
      if (scanOverlay) scanOverlay.style.display = 'none';
    }
  }

  // Lazy-load cover letter preview when switching to that tab
  if (tabId === 'tab-cover-letter' || tabId === 'cover-letter') {
    const bar = el('agent-download-bar');
    const scanId = getActiveScanId();
    const canGenerateCoverLetter = scanHasTargetJob(currentScan);

    if (scanId) {
      // Update the bar dataset if needed
      if (bar && !bar.dataset.scanId) {
        bar.dataset.scanId = String(scanId);
      }

      const actions = el('cover-letter-actions');
      if (!canGenerateCoverLetter) {
        renderCoverLetter('');
        if (actions) actions.style.display = 'none';
        return;
      }
      reloadCoverLetterPreview(scanId);
      if (actions) actions.style.display = 'flex';
    }
  }
}

function setupPdfPreviewControls() {
  pdfPreviewController?.setupControls();
}

function setPdfPreviewMode(mode) {
  pdfPreviewController?.setMode(mode);
}

function setPdfPreviewFocusMode(active) {
  pdfPreviewController?.setFocusMode(active);
}

// ── Company detection from URL ─────────────────────────────────
function extractCompanyFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    // Greenhouse: boards.greenhouse.io/companyslug or greenhouse.io/company
    const ghMatch = host.match(/^(?:boards\.)?greenhouse\.io$/) && u.pathname.match(/^\/([^/]+)/);
    if (ghMatch) return capitalize(ghMatch[1].replace(/-/g, ' '));

    // Lever: jobs.lever.co/company
    if (host === 'lever.co' || host.endsWith('.lever.co')) {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) return capitalize(seg.replace(/-/g, ' '));
    }

    // Workday: companyname.wd5.myworkdayjobs.com  or  company.workday.com
    const wdMatch = host.match(/^([a-z0-9-]+)\.(?:wd\d+\.myworkdayjobs|workday)\.com$/);
    if (wdMatch) return capitalize(wdMatch[1].replace(/-/g, ' '));

    // SmartRecruiters: jobs.smartrecruiters.com/Company/
    if (host === 'jobs.smartrecruiters.com') {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) return seg.replace(/([A-Z])/g, ' $1').trim();
    }

    // iCIMS: company.icims.com
    const icimsMatch = host.match(/^([a-z0-9-]+)\.icims\.com$/);
    if (icimsMatch) return capitalize(icimsMatch[1].replace(/-/g, ' '));

    // Ashby: jobs.ashbyhq.com/company
    if (host === 'jobs.ashbyhq.com') {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) return capitalize(seg.replace(/-/g, ' '));
    }

    // LinkedIn: linkedin.com/jobs/view/data-analyst-at-ucc-academy-4383701980/
    // Extract company from slug via "-at-" pattern (strip trailing numeric ID first).
    // If the URL is a bare numeric ID (e.g. /jobs/view/4375800397/) there's no
    // company info available — return null so no badge is shown.
    if (host === 'linkedin.com') {
      const segments = u.pathname.split('/').filter(Boolean);
      const slug = segments[segments.length - 1] || '';
      // If the slug is purely numeric, we cannot extract the company → bail out
      if (/^\d+$/.test(slug)) return null;
      // Strip trailing long numeric ID suffix (e.g. -4383701980)
      const cleanSlug = slug.replace(/-?\d{7,}$/, '').trim();
      if (!cleanSlug) return null;
      // Look for "-at-" pattern → everything after is the company
      const atIdx = cleanSlug.lastIndexOf('-at-');
      if (atIdx !== -1) {
        const companySlug = cleanSlug.slice(atIdx + 4); // skip "-at-"
        if (companySlug.length > 1) {
          return companySlug
            .split('-')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        }
      }
      return null; // slug present but no -at- pattern → can't determine company
    }
    if (host === 'indeed.com' || host === 'glassdoor.com' || host === 'naukri.com') return null;

    // Generic: use SLD (e.g. stripe.com → Stripe, airbnb.jobs → Airbnb)
    const parts = host.split('.');
    // Try second-to-last part (the registrable domain before TLD)
    const sld = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (sld && sld.length > 2) return capitalize(sld);
  } catch {
    /* invalid URL */
  }
  return null;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function isPlaceholderJobTitle(value = '') {
  const clean = String(value || '').trim();
  return /^(full job description|job description|ats-optimized|target role pending|target job pending)$/i.test(
    clean
  );
}

function isPlaceholderCompanyName(value = '') {
  const clean = String(value || '').trim();
  return /^(ats-optimized|target company pending|company pending|company|full job description)$/i.test(
    clean
  );
}

function isAggregatorHostname(value = '') {
  const clean = String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .toLowerCase();
  return (
    /(^|\.)indeed\./i.test(clean) ||
    /(^|\.)linkedin\.com$/i.test(clean) ||
    /(^|\.)glassdoor\./i.test(clean) ||
    /(^|\.)naukri\./i.test(clean)
  );
}

function getJobContext(scanOrContext = null) {
  const source = scanOrContext || currentJobContext || currentScan || {};
  const nested = source.jobContext || {};
  const rawJobTitle = nested.jobTitle || source.jobTitle || source.job_title || '';
  const rawCompanyName = nested.companyName || source.companyName || source.company_name || '';
  return {
    jobUrl: nested.jobUrl || source.jobUrl || source.job_url || '',
    jobTitle: isPlaceholderJobTitle(rawJobTitle) ? '' : rawJobTitle,
    companyName:
      isPlaceholderCompanyName(rawCompanyName) || isAggregatorHostname(rawCompanyName)
        ? ''
        : rawCompanyName,
    jdText: nested.jdText || source.jdText || source.jobDescription || source.job_description || '',
    jdSource: nested.jdSource || source.jdSource || '',
    scrapeStatus: nested.scrapeStatus || source.scrapeStatus || '',
    scrapeError: nested.scrapeError || source.scrapeError || '',
    atsPlatform: nested.atsPlatform || source.atsPlatform || source.ats_platform || '',
    atsDisplayName: nested.atsDisplayName || source.atsDisplayName || '',
    templateProfile: nested.templateProfile || source.templateProfile || null,
  };
}

function looksLikeJobUrl(value = '') {
  const trimmed = String(value || '').trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function hasManualJobDescription(value = '') {
  const trimmed = String(value || '').trim();
  return !!trimmed && !looksLikeJobUrl(trimmed);
}

function hasResolvedJobContext(jobContext = currentJobContext) {
  const context = getJobContext(jobContext);
  return !!(
    context.jobUrl &&
    context.jdText &&
    context.jobTitle &&
    context.companyName &&
    context.scrapeStatus === 'ready'
  );
}

function setLockedFieldState(field, { locked = false, reason = '', lockedPlaceholder = '' } = {}) {
  if (!field) return;

  if (!field.dataset.originalPlaceholder) {
    field.dataset.originalPlaceholder = field.getAttribute('placeholder') || '';
  }

  field.disabled = locked;
  field.classList.toggle('is-locked', locked);
  field.setAttribute('aria-disabled', locked ? 'true' : 'false');

  if (locked) {
    if (reason) field.setAttribute('title', reason);
    if (!field.value.trim() && lockedPlaceholder) field.placeholder = lockedPlaceholder;
  } else {
    field.removeAttribute('title');
    field.placeholder = field.dataset.originalPlaceholder || '';
  }
}

function syncTargetInputState() {
  const urlInput = el('job-url-input');
  const jobInput = el('job-input');
  if (!urlInput || !jobInput) return;

  const pastedJobDescriptionActive = hasManualJobDescription(jobInput.value);
  const resolvedJobLinkActive = !pastedJobDescriptionActive && hasResolvedJobContext(currentJobContext);

  setLockedFieldState(urlInput, {
    locked: pastedJobDescriptionActive,
    reason: pastedJobDescriptionActive
      ? 'Clear the pasted job description to switch back to a job link.'
      : '',
    lockedPlaceholder: 'Clear the pasted job description to use a job link.',
  });

  setLockedFieldState(jobInput, {
    locked: resolvedJobLinkActive,
    reason: resolvedJobLinkActive
      ? 'We already fetched the role, company, portal, and JD from the link above.'
      : '',
    lockedPlaceholder:
      'Job details are already locked from the fetched link above. Clear the link to paste a manual JD instead.',
  });
}

function getJobSourceLabel(jobContext) {
  switch (jobContext.jdSource) {
    case 'scraped_url':
      return 'Fetched from job link';
    case 'pasted_fallback':
      return 'Using pasted JD fallback';
    case 'pasted_text':
      return 'Using pasted job description';
    case 'url_only':
      return 'Job link needs pasted JD';
    default:
      return jobContext.jobUrl ? 'Waiting on job link' : 'No job source yet';
  }
}

function getJobStatusTone(jobContext) {
  if (jobContext.scrapeStatus === 'blocked' || jobContext.scrapeStatus === 'failed') {
    return 'is-warning';
  }
  if (
    jobContext.scrapeStatus === 'ready' ||
    jobContext.jdSource === 'pasted_fallback' ||
    jobContext.jdSource === 'pasted_text'
  ) {
    return 'is-success';
  }
  return 'is-info';
}

function renderJobLinkStatus(jobContext, options = {}) {
  const statusEl = el('job-link-status');
  const preview = el('company-preview');
  const favicon = el('company-favicon');
  const nameEl = el('company-name-preview');
  if (!statusEl || !preview || !nameEl) return;

  const state = options.state || 'idle';
  const note =
    options.note ||
    (state === 'fetching'
      ? 'Fetching the role, company, and portal so we can target the right ATS profile.'
      : jobContext.scrapeError || '');

  const validUrl =
    jobContext.jobUrl &&
    (jobContext.jobUrl.startsWith('http://') || jobContext.jobUrl.startsWith('https://'));

  if (!validUrl && !jobContext.jobTitle && !jobContext.companyName && !note) {
    statusEl.style.display = 'none';
    preview.style.display = 'none';
    return;
  }

  if (jobContext.companyName) {
    nameEl.textContent = jobContext.companyName;
    try {
      const domain = new URL(jobContext.jobUrl).hostname;
      favicon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
      favicon.onerror = () => {
        favicon.style.display = 'none';
      };
      favicon.onload = () => {
        favicon.style.display = 'inline-block';
      };
      favicon.style.display = 'none';
    } catch {
      favicon.style.display = 'none';
    }
    preview.style.display = 'flex';
  } else {
    preview.style.display = 'none';
  }

  const portalLabel = jobContext.atsDisplayName || 'General ATS';
  const statusTone = getJobStatusTone(jobContext);
  const statusTitle =
    state === 'fetching'
      ? 'Fetching job details'
      : jobContext.scrapeStatus === 'blocked'
        ? 'Portal blocked automatic fetch'
          : jobContext.scrapeStatus === 'failed'
            ? 'Automatic fetch needs a fallback'
            : jobContext.jdSource === 'pasted_fallback' || jobContext.jdSource === 'pasted_text'
              ? 'Using your pasted job description'
              : jobContext.jdSource === 'scraped_url'
                ? 'Job link resolved'
                : 'Target role ready';

  const pills = [
    {
      tone: state === 'fetching' ? 'is-info' : statusTone,
      label:
        state === 'fetching'
          ? 'Fetching JD'
          : jobContext.jdSource === 'pasted_text'
            ? 'Pasted JD'
          : jobContext.jdSource === 'pasted_fallback'
            ? 'Fallback active'
          : jobContext.scrapeStatus === 'ready'
            ? 'JD captured'
            : jobContext.scrapeStatus === 'blocked'
              ? 'Fallback needed'
              : jobContext.jdSource === 'pasted_fallback'
                ? 'Fallback active'
                : 'JD pending',
    },
    {
      tone: jobContext.companyName ? 'is-success' : 'is-info',
      label: jobContext.companyName ? jobContext.companyName : 'Company pending',
    },
    {
      tone: jobContext.atsDisplayName ? 'is-success' : 'is-info',
      label: portalLabel,
    },
  ];

  statusEl.style.display = 'block';
  statusEl.innerHTML = safeHtml(`
    <div class="job-link-status-row">
      <div class="job-link-status-title">${esc(statusTitle)}</div>
      <div class="job-link-status-pills">
        ${pills
          .map(
            pill => `<span class="job-link-pill ${pill.tone}">${esc(pill.label)}</span>`
          )
          .join('')}
      </div>
    </div>
    <div class="job-link-status-note">${esc(note || getJobSourceLabel(jobContext))}</div>
  `);
}

function renderScanLoadingContext(jobContext) {
  const titleEl = el('scan-loading-title');
  const subtitleEl = el('scan-loading-subtitle');
  const contextEl = el('scan-loading-context');
  if (!titleEl || !subtitleEl || !contextEl) return;

  if (!jobContext || (!jobContext.jobUrl && !jobContext.jobTitle && !jobContext.companyName)) {
    contextEl.style.display = 'none';
    titleEl.textContent = 'Building your ATS-targeted workspace...';
    subtitleEl.textContent =
      'We fetch the job when possible, detect the hiring portal, and build a preview before any export credit is required.';
    return;
  }

  const portalLabel = jobContext.atsDisplayName || 'General ATS';
  const roleLabel = jobContext.jobTitle || 'Target role resolving';
  const sourceLabel = getJobSourceLabel(jobContext);
  const fetchLabel =
    jobContext.jdSource === 'pasted_fallback'
      ? 'Fallback active'
      : jobContext.scrapeStatus === 'ready'
      ? 'Job details ready'
      : jobContext.scrapeStatus === 'blocked'
        ? 'Paste JD to finish targeting'
        : jobContext.scrapeStatus === 'failed'
          ? 'Retrying fetch logic'
          : 'Fetching job details';

  titleEl.textContent = jobContext.jobTitle
    ? `Optimizing for ${jobContext.jobTitle}`
    : 'Building your ATS-targeted workspace...';
  subtitleEl.textContent = jobContext.companyName
    ? `Detected ${jobContext.companyName}. We are matching the resume to the role and shaping it for the right hiring portal.`
    : 'We are extracting the job details, choosing the ATS profile, and preparing your preview.';

  contextEl.style.display = 'flex';
  contextEl.innerHTML = safeHtml(`
    <span class="scan-loading-pill ${getJobStatusTone(jobContext)}">${esc(fetchLabel)}</span>
    <span class="scan-loading-pill is-info">${esc(portalLabel)}</span>
    <span class="scan-loading-pill ${jobContext.companyName ? 'is-success' : 'is-info'}">${esc(
      jobContext.companyName || roleLabel
    )}</span>
    <span class="scan-loading-pill is-info">${esc(sourceLabel)}</span>
  `);
}

function updateResultsContextStrip(scanOrContext = null) {
  const strip = el('results-context-strip');
  const pdfHeading = el('pdf-toolbar-heading');
  if (!strip) return;
  const jobContext = getJobContext(scanOrContext);

  const hasContext =
    jobContext.jobTitle ||
    jobContext.companyName ||
    jobContext.atsDisplayName ||
    jobContext.jdSource ||
    jobContext.jobUrl;

  if (!hasContext) {
    strip.style.display = 'none';
    strip.innerHTML = '';
    if (pdfHeading) pdfHeading.textContent = 'ATS-Optimized Resume';
    updateResultsWorkflowHints(scanOrContext);
    return;
  }

  if (pdfHeading) {
    pdfHeading.textContent = jobContext.atsDisplayName
      ? `${jobContext.atsDisplayName}-Ready Resume Preview`
      : 'ATS-Optimized Resume';
  }

  strip.style.display = 'grid';
  strip.innerHTML = safeHtml(`
    <div class="results-context-card">
      <span class="results-context-label">Company</span>
      <span class="results-context-value">${esc(jobContext.companyName || 'Target company pending')}</span>
    </div>
    <div class="results-context-card">
      <span class="results-context-label">Portal</span>
      <span class="results-context-value">${esc(jobContext.atsDisplayName || 'General ATS')}</span>
    </div>
    <div class="results-context-card">
      <span class="results-context-label">Source</span>
      <span class="results-context-value">${esc(getJobSourceLabel(jobContext))}</span>
    </div>
  `);
  updateResultsWorkflowHints(scanOrContext);
}

function updateResultsWorkflowHints(scanOrContext = null) {
  const jobContext = getJobContext(scanOrContext);
  const scan = scanOrContext && typeof scanOrContext === 'object' ? scanOrContext : currentScan;
  const hasTargetJob = scanHasTargetJob(scan || currentScan, jobContext);
  const portalLabel = jobContext.atsDisplayName || 'Targeted ATS';
  const companyLabel = jobContext.companyName || 'the target role';

  const setText = (id, text) => {
    const node = el(id);
    if (node) node.textContent = text;
  };

  setText('tab-meta-diagnosis', hasTargetJob ? `${portalLabel} rules` : 'Structural pass');
  setText('tab-meta-recruiter', hasTargetJob ? 'Search visibility' : 'Parser coverage');
  setText('tab-meta-cover-letter', hasTargetJob ? `For ${companyLabel}` : 'Needs target job');
  setText('tab-meta-pdf', hasTargetJob ? 'Preview before pay' : 'Structure preview');

  setText(
    'results-pane-note-diagnosis',
    hasTargetJob
      ? `Fix the highest-impact blockers first, then confirm the resume still reads cleanly for ${portalLabel}.`
      : 'Use this pass to improve parser reliability and resume structure before you aim at a specific role.'
  );
  setText(
    'results-pane-note-recruiter',
    hasTargetJob
      ? 'Check which fields stay searchable before you trust the recruiter-facing result.'
      : 'Check which fields the parser can already read before you add job-specific targeting.'
  );
  setText(
    'results-pane-note-cover-letter',
    hasTargetJob
      ? `Turn this scan into a role-aware note for ${companyLabel}.`
      : 'Add a target job link or pasted description to generate a usable cover letter.'
  );
  setText(
    'results-pane-note-pdf',
    hasTargetJob
      ? `Review the ${portalLabel}-ready export before you spend a credit.`
      : 'Inspect the structural preview here, then rerun with a target job before you export.'
  );

  const coverLetterBtn = el('btn-tab-cover-letter');
  const pdfBtn = el('btn-tab-pdf');
  if (coverLetterBtn) coverLetterBtn.classList.toggle('is-limited', !hasTargetJob);
  if (pdfBtn) pdfBtn.classList.toggle('is-limited', !hasTargetJob);
}

function setupCompanyDetection() {
  const urlInput = el('job-url-input');
  const jobInput = el('job-input');
  if (!urlInput) return;

  let debounceTimer = null;

  urlInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    if (jobContextProbeController) {
      jobContextProbeController.abort();
      jobContextProbeController = null;
    }

    const val = urlInput.value.trim();
    if (hasManualJobDescription(jobInput?.value || '')) {
      syncTargetInputState();
      return;
    }

    if (!val || !looksLikeJobUrl(val)) {
      currentJobContext = null;
      renderJobLinkStatus({}, { state: 'idle' });
      syncTargetInputState();
      return;
    }

    renderJobLinkStatus(
      {
        jobUrl: val,
        companyName: extractCompanyFromUrl(val) || '',
        atsDisplayName: '',
        jdSource: 'url_only',
        scrapeStatus: 'pending',
      },
      { state: 'fetching' }
    );

    debounceTimer = setTimeout(() => {
      jobContextProbeController = new AbortController();
      fetch(`/api/agent/job-context?jobUrl=${encodeURIComponent(val)}`, {
        credentials: 'same-origin',
        signal: jobContextProbeController.signal,
      })
        .then(async res => {
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload.error || 'Unable to inspect that job link.');
          currentJobContext = payload.jobContext || null;
          renderJobLinkStatus(payload.jobContext || {}, {
            state: payload.needsJobDescription ? 'warning' : 'resolved',
            note: payload.needsJobDescription
              ? payload.jobContext?.scrapeError ||
                'Paste the job description to keep the portal-specific optimization.'
              : '',
          });
          syncTargetInputState();
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          currentJobContext = {
            jobUrl: val,
            companyName: extractCompanyFromUrl(val) || '',
            jdSource: 'url_only',
            scrapeStatus: 'failed',
            scrapeError: err.message,
          };
          renderJobLinkStatus(
            currentJobContext,
            { state: 'warning', note: err.message }
          );
          syncTargetInputState();
        });
    }, 350);
  });
}

// ── File Upload + Scan ─────────────────────────────────────────
function setupFileUpload() {
  const form = el('scan-form');
  const fileInput = el('resume-file');
  const area = el('upload-area');
  if (!form || !area) return;

  setupCompanyDetection();

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['.pdf', '.docx'];
  const urlInput = el('job-url-input');
  const jobInput = el('job-input');

  function showFilePreview(file) {
    if (!file) return;
    // Validate type
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) {
      el('scan-error').textContent =
        `Unsupported file type "${ext}". Please upload a PDF or DOCX resume.`;
      el('scan-error').style.display = 'block';
      fileInput.value = '';
      return;
    }
    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      el('scan-error').textContent =
        `File too large (${formatFileSize(file.size)}). Maximum size is 5MB.`;
      el('scan-error').style.display = 'block';
      fileInput.value = '';
      return;
    }
    el('scan-error').style.display = 'none';
    el('file-name-display').textContent = file.name;
    el('file-size-display').textContent = formatFileSize(file.size);
    el('file-preview').style.display = 'flex';
    area.classList.add('file-selected');

    // Enable scan submit button
    const submitBtn = el('scan-submit-btn');
    if (submitBtn) submitBtn.disabled = false;

    // Progressive disclosure: reveal job details section
    const jobDetailsSection = el('job-details-section');
    if (jobDetailsSection) {
      jobDetailsSection.classList.add('is-active');
    }

    // Scroll job details into view on mobile
    if (window.innerWidth < 768) {
      setTimeout(() => {
        jobDetailsSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }

    const iconEl = el('file-preview').querySelector('.file-preview-icon');
    if (iconEl) iconEl.dataset.fileType = ext.replace('.', '').toUpperCase();
  }

  function removeFile() {
    fileInput.value = '';
    el('file-preview').style.display = 'none';
    area.classList.remove('file-selected');
    currentJobContext = null;
    renderJobLinkStatus({}, { state: 'idle' });
    renderScanLoadingContext(null);
    // Disable scan submit button
    const submitBtn = el('scan-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    // Progressive disclosure: hide job details section
    const jobDetailsSection = el('job-details-section');
    if (jobDetailsSection) {
      jobDetailsSection.classList.remove('is-active');
    }

    const iconEl = el('file-preview')?.querySelector('.file-preview-icon');
    if (iconEl) iconEl.dataset.fileType = '';
    syncTargetInputState();
  }

  function setManualJobDescriptionMode() {
    if (!jobInput) return;
    const pastedText = jobInput.value.trim();
    if (!hasManualJobDescription(pastedText)) {
      if (!urlInput?.value.trim()) {
        currentJobContext = null;
        renderJobLinkStatus({}, { state: 'idle' });
      } else if (looksLikeJobUrl(urlInput.value)) {
        urlInput.dispatchEvent(new Event('input'));
      } else if (hasResolvedJobContext(currentJobContext)) {
        renderJobLinkStatus(currentJobContext, { state: 'resolved' });
      }
      syncTargetInputState();
      return;
    }

    if (jobContextProbeController) {
      jobContextProbeController.abort();
      jobContextProbeController = null;
    }

    currentJobContext = {
      jobUrl: '',
      jobTitle: '',
      companyName: '',
      jdText: pastedText,
      jdSource: 'pasted_text',
      scrapeStatus: 'not_requested',
      scrapeError: '',
      atsPlatform: '',
      atsDisplayName: '',
      templateProfile: null,
    };

    renderJobLinkStatus(currentJobContext, {
      state: 'resolved',
      note: 'Using your pasted job description. Clear it to switch back to automatic job-link fetch.',
    });
    syncTargetInputState();
  }

  area.addEventListener('click', () => fileInput.click());
  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('dragover');
  });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files.length > 1) {
      showToast('Please drop only one resume file at a time.', 'warning');
    }
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      showFilePreview(fileInput.files[0]);
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) showFilePreview(fileInput.files[0]);
  });

  const removeBtn = el('file-remove-btn');
  if (removeBtn)
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeFile();
    });

  if (jobInput) {
    jobInput.addEventListener('input', () => {
      setManualJobDescriptionMode();
    });
  }

  syncTargetInputState();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!fileInput.files.length) {
      el('scan-error').textContent = 'Please select a resume file first.';
      el('scan-error').style.display = 'block';
      return;
    }

    const urlInputVal = el('job-url-input') ? el('job-url-input').value.trim() : '';
    lastJobInput = el('job-input').value;
    const jdVal = lastJobInput.trim();
    const hasJobUrl = looksLikeJobUrl(urlInputVal) || looksLikeJobUrl(jdVal);
    const hasPastedJobDescription = hasManualJobDescription(jdVal);

    if (!hasJobUrl && !hasPastedJobDescription) {
      el('scan-error').textContent =
        'Add a job link or paste the job description so we can optimize this resume for a real application.';
      el('scan-error').style.display = 'block';
      renderJobLinkStatus(currentJobContext || {}, {
        state: 'warning',
        note: 'A target job is required for portal-aware resume and cover-letter generation.',
      });
      return;
    }

    if (urlInputVal && !looksLikeJobUrl(urlInputVal) && !hasPastedJobDescription) {
      el('scan-error').textContent =
        'Enter a full job link starting with http:// or https://, or paste the job description below.';
      el('scan-error').style.display = 'block';
      return;
    }

    el('scan-error').style.display = 'none';
    form.style.display = 'none';
    el('scan-loading').style.display = 'flex';
    renderScanLoadingContext(currentJobContext);

    const fd = new FormData();
    fd.append('resume', fileInput.files[0]);

    // Prefer a resolved job link. If the user pasted a manual JD, keep that as the
    // primary source and only forward the URL when it was already being used as a
    // blocked-fetch fallback so we can still infer the portal safely.
    if (hasPastedJobDescription) {
      fd.append('jobDescription', jdVal);
      if (
        urlInputVal &&
        looksLikeJobUrl(urlInputVal) &&
        currentJobContext?.jobUrl === urlInputVal &&
        ['blocked', 'failed'].includes(currentJobContext?.scrapeStatus)
      ) {
        fd.append('jobUrl', urlInputVal);
      }
    } else if (urlInputVal && looksLikeJobUrl(urlInputVal)) {
      fd.append('jobUrl', urlInputVal);
    } else if (looksLikeJobUrl(jdVal)) {
      fd.append('jobUrl', jdVal);
    } else if (jdVal) {
      fd.append('jobDescription', jdVal);
    }

    try {
      // Ensure we have a fresh CSRF token before submitting (prevents race on first load)
      if (!_csrfToken) await fetchCsrfToken();
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        body: fd,
        headers: _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {},
      });
      const data = await res.json();

      if (data.error) {
        form.style.display = 'block';
        el('scan-loading').style.display = 'none';
        if (data.jobContext) {
          currentJobContext = data.jobContext;
          renderJobLinkStatus(data.jobContext, {
            state: data.needsJobDescription ? 'warning' : 'resolved',
            note: data.error,
          });
        }
        let errHtml = esc(data.error);
        if (data.signup || data.upgrade) {
          const path = data.signup ? '/signup' : '/pricing';
          const label = data.signup
            ? 'Create a free account to continue →'
            : 'Upgrade for unlimited scans →';
          errHtml += `<br><a href="${path}" data-link style="color:var(--accent);text-decoration:underline;font-weight:600;margin-top:0.5rem;display:inline-block">${label}</a>`;
        }
        el('scan-error').innerHTML = safeHtml(errHtml);
        el('scan-error').style.display = 'block';
      } else {
        currentJobContext = data.jobContext || currentJobContext;
        renderScanLoadingContext(currentJobContext);
        // Start the live streaming agent
        // IMPORTANT: Do NOT use navigateTo('/agent-results') here!
        // The router's /agent-results handler checks localStorage for old scan IDs
        // and redirects to /results/{oldId}, which races with the new SSE stream.
        // Instead, directly activate the view and start the analysis.
        localStorage.removeItem('resumeXray_currentScanId');
        persistCurrentScanToken('');
        currentScan = null;
        history.pushState({}, '', '/agent-results');
        // Ensure we are viewing the diagnosis tab during the scan
        switchTab('tab-diagnosis');

        startAgentAnalysis(data.sessionId, data.jobContext || null);
      }
    } catch (err) {
      form.style.display = 'block';
      el('scan-loading').style.display = 'none';
      const errMsg = err.message || 'Analysis failed. Please try again.';
      el('scan-error').textContent = errMsg;
      el('scan-error').style.display = 'block';
      console.error('Scan submit error:', err);
    }
  });
}

// ── Agent Live Streaming ───────────────────────────────────────
let agentSource = null;
let currentAgentStep = null;
let pendingBullets = new Set();

function setupAgentResults() {
  const dDocx = el('download-docx');
  const dPdf = el('download-pdf');
  if (dDocx) dDocx.addEventListener('click', () => downloadOptimized('docx'));
  if (dPdf) dPdf.addEventListener('click', () => downloadOptimized('pdf'));
}

function startAgentAnalysis(sessionId, initialJobContext = null) {
  currentJobContext = initialJobContext || currentJobContext;
  // 1. Immediately Activate View — BEFORE anything else
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const resultsView = el('view-results');
  if (resultsView) resultsView.classList.add('active');

  // 2. Show "Initializing" block immediately — FIXES BLANK PAGE
  const initBlock = el('results-initializing');
  if (initBlock) initBlock.style.display = 'block';

  // 3. Hide Dashboard layout until session connects
  const dashboard = el('results-dashboard');
  if (dashboard) dashboard.style.display = 'none';

  const tabsReset = el('results-tabs-menu');
  if (tabsReset) tabsReset.style.display = 'none';

  // 4. Safely Clear previous analysis UI components
  const timeline = el('agent-timeline');
  if (timeline) timeline.innerHTML = '';

  const scoreSummary = el('agent-score-summary');
  if (scoreSummary) scoreSummary.style.display = 'none';

  const downloadBar = el('agent-download-bar');
  if (downloadBar) downloadBar.style.display = 'none';

  document.querySelectorAll('.results-tab-pane').forEach(p => {
    p.classList.remove('active');
  });
  const diagPanel = el('tab-diagnosis');
  if (diagPanel) diagPanel.classList.add('active');

  // Clear persistent scan ID on new scan start
  localStorage.removeItem('resumeXray_currentScanId');

  agentBulletPairs = []; // Reset bullet pairs
  agentResumeText = '';
  currentRenderProfile = currentJobContext?.templateProfile
    ? {
        template: currentJobContext.templateProfile.template || 'refined',
        density: currentJobContext.templateProfile.defaultDensity || 'standard',
        atsPlatform: currentJobContext.atsPlatform || '',
        atsDisplayName: currentJobContext.atsDisplayName || '',
      }
    : null;
  syncTemplateSelectionUI();
  updateResultsContextStrip(currentJobContext);
  updateResultsWorkspaceHeader({ scan: { jobContext: currentJobContext }, source: 'live' });
  // Clear PDF canvas container (pdfjs doc is destroyed inside pdf-preview.mjs on next reload)
  clearPdfPreviewObjectUrl(null);

  // Nudge guests to convert — single CTA at the bottom of agent timeline only
  // (additional paywalls are overlaid on the score gauges, Cover Letter tab, etc.)
  // Removed duplicate nudge block here (issue #6) — the unlock-overlay on
  // agent-score-summary already handles this.

  const scoreAfterCard = el('score-after-card');
  if (scoreAfterCard) scoreAfterCard.style.display = 'none';
  document.querySelectorAll('.progress-step').forEach(s => {
    s.classList.remove('complete', 'running', 'error');
  });

  // SSE Reconnection State
  let sseRetryCount = 0;
  const SSE_MAX_RETRIES = 3;
  const SSE_BASE_DELAY = 1000; // 1s, 2s, 4s (exponential backoff)
  let sseTerminalState = null;

  // Unified SSE connection function with reconnection
  function connectSSE(sessionId) {
    const abortController = new AbortController();
    agentSource = abortController;

    fetch(`/api/agent/stream/${sessionId}`, {
      credentials: 'same-origin',
      signal: abortController.signal,
      headers: { Accept: 'text/event-stream' },
    })
      .then(response => {
        if (!response.ok) {
          // Non-2xx response — treat as connection failure
          throw new Error(`Stream error: ${response.status}`);
        }

        // Success — reset retry counter
        sseRetryCount = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function processSSE() {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                if (sseTerminalState === 'complete' || sseTerminalState === 'error') {
                  agentSource = null;
                  return;
                }

                // Stream ended before a terminal event — reconnect first, then fall back.
                const timeline = el('agent-timeline');
                const hasResults = timeline && timeline.children.length > 0;

                if (sseRetryCount < SSE_MAX_RETRIES) {
                  scheduleReconnect(sessionId);
                } else if (hasResults) {
                  // We have partial results, show them with a warning
                  showToast('Analysis completed with partial results.', 'warning', {
                    duration: 6000,
                  });
                  const partialScanId = getActiveScanId();
                  if (partialScanId) {
                    finalizeAgentUI({
                      scanId: partialScanId,
                      partial: true,
                      jobContext: currentJobContext,
                    });
                  } else {
                    const initBlock = el('results-initializing');
                    const errorBlock = el('results-error');
                    const dashboard = el('results-dashboard');

                    if (initBlock) initBlock.style.display = 'none';
                    if (errorBlock) errorBlock.style.display = 'block';
                    if (dashboard) dashboard.style.display = 'none';
                  }
                } else {
                  // No results and out of retries - show error state
                  const initBlock = el('results-initializing');
                  const errorBlock = el('results-error');
                  const dashboard = el('results-dashboard');

                  if (initBlock) initBlock.style.display = 'none';
                  if (errorBlock) errorBlock.style.display = 'block';
                  if (dashboard) dashboard.style.display = 'none';

                  showToast(
                    'Analysis stream ended unexpectedly. Please start a new scan.',
                    'error',
                    { duration: 8000 }
                  );
                }
                agentSource = null;
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();

              let currentEvent = '';
              let currentData = '';

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  currentEvent = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                  currentData = line.slice(6);
                } else if (line === '' && currentEvent && currentData) {
                  handleSSEEvent(currentEvent, currentData);
                  currentEvent = '';
                  currentData = '';
                }
              }

              processSSE();
            })
            .catch(err => {
              if (err.name !== 'AbortError') {
                handleSSEError(sessionId, err);
              }
            });
        }

        processSSE();
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          handleSSEError(sessionId, err);
        }
      });
  }

  function handleSSEError(sessionId, err) {
    agentSource = null;
    if (sseRetryCount < SSE_MAX_RETRIES) {
      scheduleReconnect(sessionId);
    } else {
      // Show error state UI instead of just toast
      const initBlock = el('results-initializing');
      const errorBlock = el('results-error');
      const dashboard = el('results-dashboard');

      if (initBlock) initBlock.style.display = 'none';
      if (errorBlock) errorBlock.style.display = 'block';
      if (dashboard) dashboard.style.display = 'none';

      showToast(
        'Analysis stream disconnected after multiple attempts. Please start a new scan.',
        'error',
        { duration: 8000 }
      );
    }
  }

  function scheduleReconnect(sessionId) {
    sseRetryCount++;
    const delay = SSE_BASE_DELAY * Math.pow(2, sseRetryCount - 1);
    console.log(`SSE reconnect attempt ${sseRetryCount}/${SSE_MAX_RETRIES} in ${delay}ms`);

    setTimeout(() => {
      // Check if user hasn't started a new scan
      if (agentSource === null || agentSource === undefined) {
        connectSSE(sessionId);
      }
    }, delay);
  }

  // Start SSE connection with reconnection support
  connectSSE(sessionId);

  // SSE event dispatcher — same logic as the old EventSource listeners
  function handleSSEEvent(eventType, dataStr) {
    let data;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }

    switch (eventType) {
      case 'step':
        updateAgentProgress(data.step, data.status);
        if (data.status === 'running') {
          if (initBlock) initBlock.style.display = 'none';
          if (dashboard) dashboard.style.display = 'block';
          // Show context header on first step — pre-populate with URL company if available

          addAgentStepCard(data.step, data.name, data.label);
          // Announce step start to screen readers
          announceToScreenReader(`Starting analysis step ${data.step}: ${data.name}`);
        } else if (data.status === 'complete' || data.status === 'error') {
          if (initBlock) initBlock.style.display = 'none';
          if (dashboard) dashboard.style.display = 'block';
          updateAgentStepCard(data.step, data.status, data.label, data.data);
          // Announce step completion to screen readers
          if (data.status === 'complete') {
            announceToScreenReader(`Completed step ${data.step}: ${data.name}`);
          }
          if (data.status === 'error') {
            sseTerminalState = 'error';
            agentSource = null;
            finalizeAgentUI(data);
          }
        }
        break;

      case 'init':
        if (data.scanId) {
          localStorage.setItem('resumeXray_currentScanId', data.scanId);
          const bar = el('agent-download-bar');
          if (bar) bar.dataset.scanId = data.scanId;
        }
        if (data.accessToken) {
          persistCurrentScanToken(data.accessToken);
        }
        break;

      case 'jobContext':
        currentJobContext = data || null;
        renderScanLoadingContext(currentJobContext);
        updateResultsContextStrip({ jobContext: currentJobContext });
        updateResultsWorkspaceHeader({ scan: { jobContext: currentJobContext }, source: 'live' });
        break;

      case 'renderProfile':
        currentRenderProfile = data || null;
        syncTemplateSelectionUI();
        break;

      case 'token':
        typewriterToken(data.step, data.chunk, data.bulletIndex);
        break;

      case 'bullet':
        if (data.status === 'rewriting') {
          pendingBullets.add(data.index);
        } else if (data.status === 'complete' || data.status === 'error') {
          pendingBullets.delete(data.index);
          if (data.status === 'complete' && data.original && data.rewritten) {
            agentBulletPairs.push({
              original: data.original,
              rewritten: data.rewritten,
              method: data.method,
              targetKeyword: data.targetKeyword,
            });
          }
        }
        renderAgentBullet(data);
        break;

      case 'scores':
        updateAgentScores(data);
        // Announce scores to screen readers
        announceToScreenReader(
          `Analysis scores updated: Parse rate ${data.parseRate}%, Format health ${data.formatHealth}%, Job match ${data.matchRate}%`
        );
        break;

      case 'coverLetter':
        if (data.text) renderCoverLetter(data.text);
        break;

      case 'atsProfile':
        // Show ATS platform badge in download bar
        const atsBadge = el('ats-platform-badge');
        if (atsBadge) {
          if (data.displayName && data.name !== 'generic') {
            atsBadge.textContent = `Optimized for ${data.displayName}`;
            atsBadge.style.display = 'inline-flex';
          } else {
            atsBadge.style.display = 'none';
          }
        }
        break;

      case 'complete':
        sseTerminalState = 'complete';
        agentSource = null;
        if (data.resumeText) agentResumeText = data.resumeText;
        persistCurrentScanToken(data.accessToken || '');
        if (data.jobContext) currentJobContext = data.jobContext;
        if (data.scanId) {
          history.replaceState({}, '', `/results/${data.scanId}`);
          localStorage.setItem('resumeXray_currentScanId', String(data.scanId));
        }
        // Update context header with real job title + company from scan result

        // Announce completion to screen readers
        announceToScreenReader(
          'Resume analysis complete. Your optimized resume is ready for download.',
          'assertive'
        );

        if (currentUser) fetchUser().then(() => finalizeAgentUI(data));
        else finalizeAgentUI(data);
        break;

      case 'error':
        sseTerminalState = 'error';
        agentSource = null;
        // Hide loading state and restore the upload form so the user can retry
        const loadingEl = el('scan-loading');
        const formEl = el('scan-form');
        if (loadingEl) loadingEl.style.display = 'none';
        if (formEl) formEl.style.display = 'block';
        if (data.message && data.message.includes('professional resume')) {
          showToast(
            "This file doesn't appear to be a standard resume. Please upload a professional resume in PDF or DOCX format.",
            'warning'
          );
          document.querySelectorAll('.progress-step.running').forEach(item => {
            item.classList.remove('running');
            item.classList.add('error');
          });
        } else {
          showToast(
            data.message ||
              'Analysis interrupted — please try again. If this persists, contact support.',
            'error'
          );
        }
        if (data.step) updateAgentProgress(data.step, 'error');
        break;
    }
  }
}

function updateAgentProgress(stepNum, status) {
  const stepEl = document.querySelector(`.progress-step[data-step="${stepNum}"]`);
  if (!stepEl) return;

  if (status === 'running') {
    stepEl.classList.add('running');
  } else if (status === 'complete') {
    stepEl.classList.remove('running');
    stepEl.classList.add('complete');
  } else if (status === 'error') {
    stepEl.classList.remove('running');
    stepEl.classList.add('error');
  }

  // Mark previous steps as complete if this one is running
  if (status === 'running') {
    for (let i = 1; i < stepNum; i++) {
      const prev = document.querySelector(`.progress-step[data-step="${i}"]`);
      if (prev) {
        prev.classList.remove('running');
        prev.classList.add('complete');
      }
    }
  }
}

function addAgentStepCard(step, name, label) {
  const timeline = el('agent-timeline');
  const cardId = `agent-step-${step}`;

  if (el(cardId)) return; // Already exists

  const card = document.createElement('div');
  card.className = 'agent-step-card animate-fade-up';
  card.id = cardId;
  card.innerHTML = safeHtml(`
    <div class="agent-step-header" data-toggle-step="${step}">
      <div class="agent-step-icon running"></div>
      <div class="agent-step-label">${esc(label)}</div>
      <div class="agent-step-status">Analyzing...</div>
    </div>
    <div class="agent-step-body" id="agent-body-${step}">
      <div class="agent-stream-text" id="stream-${step}"><span class="cursor"></span></div>
    </div>
  `);
  timeline.appendChild(card);
  currentAgentStep = step;

  // Smooth scroll
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateAgentStepCard(step, status, label, data) {
  const card = el(`agent-step-${step}`);
  if (!card) return;

  const icon = card.querySelector('.agent-step-icon');
  const statusLabels = card.querySelector('.agent-step-status');
  const labelEl = card.querySelector('.agent-step-label');

  icon.className = `agent-step-icon ${status}`;
  icon.innerHTML = safeHtml(
    status === 'complete'
      ? uiIcon('check', { size: 14, stroke: 2.5 })
      : status === 'error'
        ? uiIcon('warning', { size: 14, stroke: 2 })
        : uiIcon('dot', { size: 14, stroke: 2.5 })
  );

  if (status === 'error') {
    statusLabels.textContent = 'REJECTED';
    statusLabels.style.color = 'var(--red)';
    statusLabels.style.fontWeight = '700';
  } else {
    statusLabels.textContent = status === 'complete' ? 'Completed' : 'Failed';
  }

  labelEl.textContent = label;

  // Remove cursor from stream text
  const stream = el(`stream-${step}`);
  if (stream) {
    const cursor = stream.querySelector('.cursor');
    if (cursor) cursor.remove();
  }

  // Show detailed data if available
  const body = el(`agent-body-${step}`);
  if (data && step === 1) {
    // Parse
    body.innerHTML = safeHtml(`
      <div class="flex gap-4 items-center">
        <div><strong>Sections:</strong> ${esc(data.sections.join(', '))}</div>
        <div><strong>Word Count:</strong> ${esc(String(data.wordCount))}</div>
      </div>
    `);
  } else if (step === 8 && (status === 'complete' || status === 'running')) {
    // Keyword plan step — the plan is streamed as raw JSON tokens into stream-8.
    // On completion, parse that text and render as structured suggestion cards.
    const streamEl = el(`stream-${step}`);
    if (streamEl) {
      const raw = streamEl.textContent.trim();
      let items = Array.isArray(data) ? data : null;
      if (!items && raw) {
        // Try to parse the streamed JSON blob
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) items = parsed;
        } catch {
          // Partial stream or non-JSON — extract objects manually
          const matches = raw.match(/\{[^}]+\}/g) || [];
          items = matches
            .map(s => {
              try {
                return JSON.parse(s);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        }
      }
      if (items && items.length > 0) {
        const suggestions = items
          .map(item => {
            const kw = esc(item.keyword || item.Keyword || '');
            const section = esc(item.section || item.Section || '');
            const suggestion = esc(item.suggestion || item.Suggestion || '');
            return `<div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid var(--border-subtle)">
            <span style="background:var(--accent);color:#fff;font-size:0.7rem;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0">${kw}</span>
            <span style="font-size:0.82rem;color:var(--text-secondary)">${suggestion}</span>
          </div>`;
          })
          .join('');
        streamEl.innerHTML = '';
        body.innerHTML = safeHtml(`<div style="font-size:0.82rem">${suggestions}</div>`);
      }
    }
  }
}

function typewriterToken(step, chunk, bulletIndex) {
  let targetId = `stream-${step}`;
  if (bulletIndex !== undefined) {
    targetId = `bullet-rewrite-text-${bulletIndex}`;
  } else if (String(step) === '9') {
    targetId = 'cover-letter-stream';
  }

  const container = el(targetId);
  if (!container) return;

  // Remove placeholder on first token
  const placeholder = container.querySelector('.cover-letter-placeholder');
  if (placeholder) placeholder.remove();

  const cursor =
    container.querySelector('.cursor') ||
    (function () {
      const c = document.createElement('span');
      c.className = 'cursor';
      container.appendChild(c);
      return c;
    })();

  cursor.insertAdjacentText('beforebegin', chunk);

  // Auto-scroll stream containers
  if (container.classList.contains('agent-stream-text')) {
    container.scrollTop = container.scrollHeight;
  }
}

function renderAgentBullet(data) {
  const body = el(`agent-body-${data.step}`);
  if (!body) return;

  // Skip rendering if the original text isn't a real bullet (just a metric, number, or too short)
  const isMeaningfulBullet = data.original && data.original.replace(/[\s\d%,.$-]/g, '').length >= 5;

  if (data.status === 'rewriting') {
    if (!isMeaningfulBullet) return; // Don't show cards for junk originals
    const bulletCard = document.createElement('div');
    bulletCard.className = 'agent-bullet-card animate-fade-up';
    bulletCard.id = `bullet-card-${data.index}`;
    bulletCard.innerHTML = safeHtml(`
      <div class="agent-bullet-before">
        <div class="agent-bullet-label before">BEFORE</div>
        <div class="agent-bullet-text">${esc(data.original)}</div>
      </div>
      <div class="agent-bullet-after">
        <div class="agent-bullet-label after">REFINING...</div>
        <div class="agent-bullet-text" id="bullet-rewrite-text-${data.index}"><span class="cursor"></span></div>
      </div>
    `);

    body.appendChild(bulletCard);
  } else if (data.status === 'complete') {
    const card = el(`bullet-card-${data.index}`);
    if (!card) return;

    // Finalize the rewrite
    const rewriteEl = el(`bullet-rewrite-text-${data.index}`);
    if (rewriteEl) rewriteEl.textContent = data.rewritten;

    const afterLabel = card.querySelector('.agent-bullet-label.after');
    if (afterLabel) {
      afterLabel.textContent = 'REFINED';
      afterLabel.classList.add('done');
    }

    // Add success border
    card.classList.add('bullet-complete');

    const meta = document.createElement('div');
    meta.className = 'agent-bullet-meta';
    meta.innerHTML = safeHtml(`
      <span class="badge badge-purple">${esc(data.targetKeyword || 'General')}</span>
      <span class="badge badge-blue">${esc(data.method || 'CAR Formula')}</span>
      <span class="badge badge-green">Clarity Pass</span>
    `);
    card.appendChild(meta);
  }
}

function updateAgentScores(scores) {
  const summary = el('agent-score-summary');
  if (!summary) return;
  summary.style.display = 'grid';

  const circumference = 327; // 2 * PI * 52

  function animateGauge(gaugeId, valueId, value, color) {
    if (value === null || value === undefined || typeof value === 'boolean') return;
    const num = parseFloat(value);
    if (isNaN(num)) return;

    const limited = Math.min(100, Math.max(0, num));
    const offset = circumference - (limited / 100) * circumference;
    const gauge = document.getElementById(gaugeId);
    const valueEl = document.getElementById(valueId);
    if (gauge) {
      gauge.style.stroke = color;
      setTimeout(() => {
        if (gauge) gauge.setAttribute('stroke-dashoffset', offset);
      }, 100);
    }
    if (valueEl) animateCountUp(valueEl, Math.round(limited));
  }

  function gaugeColor(v) {
    return v > 70 ? 'var(--green)' : v > 40 ? 'var(--amber)' : 'var(--red)';
  }

  const parseRate = scores.parseRate ?? scores.atsReady ?? null;
  const formatHealth = scores.formatHealth ?? null;
  const matchRate = scores.matchRate ?? scores.jobMatch ?? null;
  const matchAfter = scores.matchRateAfter ?? scores.jobMatchAfter ?? null;
  updateResultsSummary({ scores });

  if (parseRate !== null) {
    animateGauge('gauge-parse', 'score-ats-ready', parseRate, gaugeColor(parseRate));
  }
  if (formatHealth !== null) {
    animateGauge('gauge-format', 'score-format-health', formatHealth, gaugeColor(formatHealth));
  }
  if (matchRate !== null) {
    animateGauge('gauge-match', 'score-job-match', matchRate, gaugeColor(matchRate));
  }
  const scoreAfter = el('score-after-card');
  if (scoreAfter) {
    scoreAfter.style.display = matchRate !== null ? '' : 'none';
  }
  if (matchRate !== null) {
    animateGauge('gauge-after', 'score-job-match-after', matchAfter ?? matchRate, 'var(--green)');
  }
}

function updateResultsSummary({ scores = null, scan = null } = {}) {
  const strip = el('results-summary-strip');
  if (!strip) return;
  strip.style.display = 'grid';
  updateResultsContextStrip(scan || currentJobContext);

  const priorityTitleEl = el('results-priority-title');
  const priorityBodyEl = el('results-priority-body');
  const visibilityValueEl = el('results-visibility-value');
  const visibilityBodyEl = el('results-visibility-body');
  const exportValueEl = el('results-export-value');
  const exportBodyEl = el('results-export-body');

  const parseRate =
    scores?.parseRate ?? scores?.atsReady ?? scan?.parseRate ?? scan?.atsReady ?? null;
  const formatHealth = scores?.formatHealth ?? scan?.formatHealth ?? null;
  const matchRate =
    scores?.matchRate ?? scores?.jobMatch ?? scan?.matchRate ?? scan?.jobMatch ?? null;
  const keywordData = scan?.keywordData || {};
  const xrayData = scan?.xrayData || {};
  const jobContext = getJobContext(scan);
  const missingKeywords = Array.isArray(keywordData.missing) ? keywordData.missing.length : 0;
  const lowVisibilityFields = Object.values(xrayData.fieldAccuracy || {}).filter(
    info => info?.status === 'missing' || info?.status === 'warning'
  ).length;
  const creditBalance = currentUser?.user?.creditBalance || 0;
  const hasTargetJob = scanHasTargetJob(scan || currentScan, jobContext);

  let priorityTitle = 'Keep improving the strongest blocker first';
  let priorityBody =
    'We keep the highest-impact recommendation here so you do not have to scan every card before deciding what to fix next.';

  if (!hasTargetJob) {
    priorityTitle = 'Add a target job before you export';
    priorityBody =
      'This is a structural pass only. Add a job link or paste the job description so we can detect the company, portal, keywords, and cover-letter context.';
  } else if (parseRate !== null && parseRate < 70) {
    priorityTitle = 'Fix parsing blockers before anything else';
    priorityBody =
      'If the parser misses sections or fields, recruiters cannot search the experience no matter how strong the writing is.';
  } else if (formatHealth !== null && formatHealth < 70) {
    priorityTitle = 'Tighten structure before you export';
    priorityBody =
      'Formatting health is still suppressing readability. Clean structure lifts both ATS reliability and recruiter confidence.';
  } else if (missingKeywords > 0 || (matchRate !== null && matchRate < 70)) {
    priorityTitle = 'Close the job-match gap';
    priorityBody =
      missingKeywords > 0
        ? `${missingKeywords} relevant keyword${missingKeywords === 1 ? '' : 's'} are still missing from the current story.`
        : 'Your resume is readable, but it still needs stronger job-specific language to compete in search and ranking.';
  } else if (creditBalance < 1) {
    priorityTitle = 'Your resume is close, keep one export credit ready';
    priorityBody =
      'The analysis is trending well. The main remaining friction is having a credit available when you decide to ship the final version.';
  } else if (matchRate !== null) {
    priorityTitle = 'You are close to an export-ready pass';
    priorityBody =
      jobContext.atsDisplayName
        ? `The current scan now targets ${jobContext.atsDisplayName}, so the next step is validating recruiter visibility and the export preview.`
        : 'The current scan is readable and job-aware, so the next step is validating the recruiter view and exporting with confidence.';
  }

  if (priorityTitleEl) priorityTitleEl.textContent = priorityTitle;
  if (priorityBodyEl) priorityBodyEl.textContent = priorityBody;

  if (visibilityValueEl) {
    visibilityValueEl.textContent =
      !hasTargetJob
        ? 'Structural review only'
        : lowVisibilityFields > 0
        ? `${lowVisibilityFields} field${lowVisibilityFields === 1 ? '' : 's'} at risk`
        : matchRate !== null
          ? `${Math.round(matchRate)}% match`
          : 'Waiting for field data';
  }
  if (visibilityBodyEl) {
    visibilityBodyEl.textContent =
      !hasTargetJob
        ? 'Recruiter view can confirm parser coverage, but role match and portal-specific guidance stay limited without a target job.'
        : lowVisibilityFields > 0
        ? 'Recruiters may still miss part of your profile in search because extracted fields are incomplete or partial.'
        : 'The recruiter view looks structurally stronger, so focus shifts toward keyword fit and final polish.';
  }

  if (exportValueEl) {
    const exportScore =
      parseRate !== null && formatHealth !== null ? Math.round((parseRate + formatHealth) / 2) : null;
    exportValueEl.textContent =
      !hasTargetJob
        ? 'Target job required'
        : exportScore === null
        ? 'Evaluating'
        : exportScore >= 80
          ? 'Ready for final review'
          : exportScore >= 65
            ? 'Needs one more pass'
            : 'Hold export for now';
  }
  if (exportBodyEl) {
    exportBodyEl.textContent =
      !hasTargetJob
        ? 'Preview the structure for free, then rerun with a target job before you spend a credit on export.'
        : creditBalance < 1
        ? 'Scans stay free, but keep one credit available so a strong result can turn into a same-day export.'
        : jobContext.atsDisplayName
          ? `Preview the ${jobContext.atsDisplayName}-ready layout first, then export once the recruiter table and job match feel believable.`
          : 'Use export only after the parser looks stable, the recruiter table is clean, and the job match feels believable.';
  }
}

function updateResultsWorkspaceHeader({ scan = null, source = 'live' } = {}) {
  const titleEl = el('results-masthead-title');
  const bodyEl = el('results-masthead-body');
  const statusEl = el('results-masthead-status');
  const contextEl = el('results-masthead-context');
  if (!titleEl || !bodyEl || !statusEl || !contextEl) return;

  const jobContext = getJobContext(scan);
  const scanTitle = scan ? getDashboardScanTitle(scan) : 'Review the highest-impact fixes first';
  const parseRate = scan?.parseRate ?? scan?.parse_rate ?? null;
  const formatHealth = scan?.formatHealth ?? scan?.format_health ?? null;
  const matchRate = scan?.matchRate ?? scan?.match_rate ?? null;
  const hasJobContext = !!(
    jobContext.jobUrl ||
    jobContext.jobTitle ||
    (scan?.job_description || '').trim()
  );
  const readinessScore =
    parseRate !== null && formatHealth !== null ? Math.round((parseRate + formatHealth) / 2) : null;
  const roleTitle = decodeHtml(jobContext.jobTitle || scan?.job_title || '');

  titleEl.textContent =
    roleTitle && !isNoisyJobFacingTitle(roleTitle) && roleTitle.toLowerCase() !== 'no job description'
      ? roleTitle
      : scanTitle;
  bodyEl.textContent = hasJobContext
    ? jobContext.atsDisplayName
      ? `Role, company, and portal context are locked in. Use the workflow below to tighten parser coverage, recruiter visibility, and export quality for ${jobContext.atsDisplayName}.`
      : 'The job context is in place. Use the workflow below to tighten parser coverage, recruiter visibility, and export quality.'
    : 'This is a resume-only structural review. Add a target job link or paste the job description to unlock portal detection, match analysis, and a usable cover letter.';

  if (scan && !hasJobContext) {
    statusEl.textContent = 'Target job required';
    statusEl.dataset.state = 'needs-target';
  } else if (readinessScore !== null && readinessScore >= 80) {
    statusEl.textContent = 'Ready for export review';
    statusEl.dataset.state = 'ready';
  } else if (readinessScore !== null && readinessScore >= 65) {
    statusEl.textContent = 'One more polish pass';
    statusEl.dataset.state = 'review';
  } else if (scan) {
    statusEl.textContent = 'Still needs cleanup';
    statusEl.dataset.state = 'progress';
  } else {
    statusEl.textContent = 'Awaiting analysis';
    statusEl.dataset.state = 'idle';
  }

  if (scan) {
    const contextParts = [
      source === 'history' ? 'Saved scan' : 'Live workspace',
      hasJobContext
        ? jobContext.atsDisplayName
          ? `${jobContext.atsDisplayName} targeted`
          : 'Targeted review'
        : 'Structural review',
      hasJobContext && matchRate !== null ? `${Math.round(matchRate)}% match` : null,
    ].filter(Boolean);
    contextEl.textContent = contextParts.join(' · ');
    contextEl.dataset.state = hasJobContext ? 'targeted' : 'structural';
  } else {
    contextEl.textContent = 'Resume review';
    contextEl.dataset.state = 'idle';
  }
}

async function finalizeAgentUI(data) {
  // 1. Wait for pending bullets
  let attempts = 0;
  while (pendingBullets.size > 0 && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }

  // 2. Clean up lingering animations
  document.querySelectorAll('.agent-bullet-label.after').forEach(label => {
    if (label.textContent === 'REFINING...') label.textContent = 'REFINED';
  });
  document.querySelectorAll('.cursor').forEach(c => c.remove());

  // 3. Store scanId in memory with normalized shape
  //    The SSE complete event uses .scanId; the API uses .id
  //    We normalize so both paths work.
  if (data.scanId) {
    currentScan = { ...data, id: data.scanId };
  }
  if (data.jobContext) currentJobContext = data.jobContext;
  updateResultsContextStrip(currentJobContext);
  updateResultsWorkspaceHeader({ scan: currentScan, source: 'live' });

  // 4. Show Dashboard & Reveal Tabs
  const dashboard = el('results-dashboard');
  if (dashboard) dashboard.style.display = '';

  const tabMenu = el('results-tabs-menu');
  if (tabMenu) tabMenu.style.display = ''; // Let CSS (grid on mobile, flex on desktop) take over

  // Prepare PDF viewer overlay
  const scanOverlay = el('pdf-scanning-overlay');
  const viewOverlay = el('pdf-viewer-overlay');
  if (scanOverlay) scanOverlay.style.display = 'none';
  if (viewOverlay) viewOverlay.style.display = 'flex';

  // Ensure tab panes have no inline display — CSS classes control visibility
  document.querySelectorAll('.results-tab-pane').forEach(p => (p.style.display = ''));

  // 5. Store scanId for lazy-loading in the PDF tab
  const bar = el('agent-download-bar');
  if (bar && data.scanId) {
    bar.dataset.scanId = data.scanId;
    bar.style.display = '';
  }

  // 5b. Initialize PDF preview immediately if on PDF tab or prepare for lazy loading
  if (data.scanId) {
    const currentTab = sessionStorage.getItem('resumeXray_activeTab') || 'tab-diagnosis';
    if (currentTab === 'tab-pdf-preview') {
      reloadPdfPreview(data.scanId);
    }
  }

  // 6. No full-page overlay — just show the tab and toast
  switchTab('tab-diagnosis');
  showToast(
    scanHasTargetJob(currentScan, currentJobContext)
      ? 'Analysis complete. Your export preview is ready for review.'
      : 'Analysis complete. Review the structural pass, then rerun with a target job for export-ready feedback.',
    'success'
  );

  // Smooth scroll to the score gauges
  const scoreSummary = el('agent-score-summary');
  if (scoreSummary) {
    scoreSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 7. Fetch full scan data from API to populate Recruiter View + PDF preview
  if (data.scanId) {
    try {
      const scanRes = await fetch(buildScanApiUrl(data.scanId));
      if (scanRes.ok) {
        const scanJson = await scanRes.json();
        if (scanJson.results) {
          const fullData = scanJson.results;
          currentScan = { ...currentScan, ...fullData, id: data.scanId };
          currentJobContext = getJobContext(fullData);
          updateResultsSummary({ scores: fullData, scan: fullData });
          updateResultsWorkspaceHeader({ scan: fullData, source: 'live' });

          renderRecruiterVisibility(fullData.xrayData || {}, fullData.keywordData || {});

          // Populate Cover Letter
          if (fullData.coverLetterText) {
            renderCoverLetter(fullData.coverLetterText);
          } else {
            const clContainer = el('cover-letter-content');
            const hasTargetJob = scanHasTargetJob(fullData, getJobContext(fullData));
            if (clContainer)
              clContainer.innerHTML = safeHtml(
                hasTargetJob
                  ? '<div class="preview-empty" style="padding:2rem;text-align:center;color:var(--text-muted);"><div style="display:flex;justify-content:center;margin-bottom:1rem;opacity:0.34">' +
                    uiIcon('mail', { size: 44, stroke: 1.7 }) +
                    '</div><h4 style="margin-bottom:0.5rem">Cover letter preview unavailable</h4><p class="body-sm" style="margin-bottom:1rem">We resolved the target role, but this scan did not return a usable cover letter yet. Run a fresh targeted scan to regenerate it cleanly.</p><button class="btn btn-primary btn-sm" data-action="navigate" data-path="/scan">Start New Targeted Scan</button></div>'
                  : '<div class="preview-empty" style="padding:2rem;text-align:center;color:var(--text-muted);"><div style="display:flex;justify-content:center;margin-bottom:1rem;opacity:0.34">' +
                    uiIcon('mail', { size: 44, stroke: 1.7 }) +
                    '</div><h4 style="margin-bottom:0.5rem">No cover letter for this scan</h4><p class="body-sm" style="margin-bottom:1rem">This scan only reviewed the resume structure. Add a target job link or paste the job description to generate a cover letter.</p><button class="btn btn-primary btn-sm" data-action="navigate" data-path="/scan">Start Targeted Scan</button></div>'
              );
            const clActions = el('cover-letter-actions');
            if (clActions) clActions.style.display = 'none';
          }

          const atsBadge = el('ats-platform-badge');
          if (atsBadge) {
            if (currentJobContext.atsDisplayName && currentJobContext.atsPlatform !== 'generic') {
              atsBadge.textContent = `Optimized for ${currentJobContext.atsDisplayName}`;
              atsBadge.style.display = 'inline-flex';
            } else {
              atsBadge.style.display = 'none';
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch full scan data for recruiter view:', e);
    }
  }

  // 8. Update download bar credit balance
  const creditBalance = currentUser?.user?.creditBalance || 0;
  const balanceEl = el('download-balance');
  if (balanceEl)
    balanceEl.innerHTML = safeHtml(
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${esc(creditBalance)} credits`
    );

  if (creditBalance < 1 && currentUser) {
    const msgEl = el('download-credit-msg');
    if (msgEl)
      msgEl.innerHTML = safeHtml(
        'You need 1 credit to download. <a href="/pricing" data-link style="color:var(--accent)">Buy credits →</a>'
      );
  }
}

// ── Shared Dashboard Variables ─────────────────────────────────
let agentResumeText = '';
let agentBulletPairs = []; // {original, rewritten, method, targetKeyword}

function getPasswordToggleIcon(isVisible) {
  if (isVisible) {
    return `
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l18 18" />
        <path d="M10.58 10.58a2 2 0 102.83 2.83" />
        <path d="M9.88 5.09A9.77 9.77 0 0112 5c7 0 11 7 11 7a18.78 18.78 0 01-5.17 5.64" />
        <path d="M6.61 6.61A18.72 18.72 0 001 12s4 7 11 7a10.76 10.76 0 005.39-1.39" />
      </svg>
    `;
  }

  return `
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  `;
}

function setupPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const input = btn.previousElementSibling;
      if (input && input.tagName === 'INPUT') {
        if (input.type === 'password') {
          input.type = 'text';
          btn.innerHTML = getPasswordToggleIcon(true);
          btn.setAttribute('aria-label', 'Hide password');
        } else {
          input.type = 'password';
          btn.innerHTML = getPasswordToggleIcon(false);
          btn.setAttribute('aria-label', 'Show password');
        }
      }
    });
  });
}

function setupResultsTabs() {
  const tabs = Array.from(document.querySelectorAll('.results-tab-btn'));

  // Delegate to switchTab() which handles activation, lazy-loading, and aria attributes
  tabs.forEach((btn, index) => {
    // Set up initial ARIA attributes
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
    btn.setAttribute('tabindex', btn.classList.contains('active') ? '0' : '-1');

    // Add aria-controls linking to tabpanel
    const targetId = btn.getAttribute('data-tab');
    if (targetId) {
      btn.setAttribute('aria-controls', targetId);
    }

    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      if (targetId) {
        // Clear rogue inline display styles before switching
        document.querySelectorAll('.results-tab-pane').forEach(p => (p.style.display = ''));
        switchTab(targetId);
        sessionStorage.setItem('resumeXray_activeTab', targetId);
      }
    });

    // Keyboard navigation for tabs (ARIA tabs pattern)
    btn.addEventListener('keydown', e => {
      let newIndex = index;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          newIndex = (index + 1) % tabs.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          newIndex = (index - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          e.preventDefault();
          newIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          newIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      const newTab = tabs[newIndex];
      const targetId = newTab.getAttribute('data-tab');
      if (targetId) {
        switchTab(targetId);
        sessionStorage.setItem('resumeXray_activeTab', targetId);
      }
    });
  });

  // ── Layout Density Selector Event Listeners ──
  // (Template and density selectors removed from UI — hardcoded to modern+standard)
  // Listeners kept as no-ops for safety in case elements re-appear
  ['density-standard', 'density-compact'].forEach(id => {
    const btn = el(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const bar = el('agent-download-bar');
      const scanId = bar ? bar.dataset.scanId : null;
      if (!scanId) return;
      document.querySelectorAll('[data-density]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reloadPdfPreview(scanId);
    });
  });

  // ── Template Selector Event Listeners ──
  document.querySelectorAll('[data-template]').forEach(btn => {
    btn.addEventListener('click', () => {
      const scanId = getActiveScanId();
      if (!scanId) return;
      setSelectedTemplate(btn.dataset.template || 'refined');
      const activeTab =
        document.querySelector('.results-tab-pane.active')?.id ||
        sessionStorage.getItem('resumeXray_activeTab') ||
        'tab-pdf-preview';
      if (activeTab === 'tab-cover-letter') {
        reloadCoverLetterPreview(scanId);
      } else {
        reloadPdfPreview(scanId);
      }
    });
  });

  syncTemplateSelectionUI();
}

// ── Helpers for current preview state ──
function getSelectedTemplate() {
  return (
    currentRenderProfile?.template ||
    currentJobContext?.templateProfile?.template ||
    currentScan?.renderMeta?.renderTemplate ||
    'refined'
  );
}

function getSelectedDensity() {
  return (
    currentRenderProfile?.density ||
    currentJobContext?.templateProfile?.defaultDensity ||
    currentScan?.renderMeta?.renderDensity ||
    'standard'
  );
}

function syncTemplateSelectionUI() {
  document.querySelectorAll('[data-template]').forEach(button => {
    button.classList.toggle('active', button.dataset.template === getSelectedTemplate());
  });
}

function setSelectedTemplate(template) {
  const nextTemplate = ['refined', 'executive', 'corporate', 'modern', 'classic', 'minimal'].includes(template)
    ? template
    : 'refined';
  currentRenderProfile = {
    ...(currentRenderProfile || {}),
    template: nextTemplate,
    density: getSelectedDensity(),
    atsPlatform: currentRenderProfile?.atsPlatform || currentJobContext?.atsPlatform || '',
    atsDisplayName:
      currentRenderProfile?.atsDisplayName || currentJobContext?.atsDisplayName || '',
  };
  syncTemplateSelectionUI();
}

function currentPreviewProfileQuery() {
  const template = getSelectedTemplate();
  const density = getSelectedDensity();
  const params = [];
  if (template) params.push(`template=${encodeURIComponent(template)}`);
  if (density) params.push(`density=${encodeURIComponent(density)}`);
  return params.length ? `&${params.join('&')}` : '';
}

async function reloadPdfPreview(scanId) {
  return pdfPreviewController?.reloadPreview(scanId);
}

async function downloadOptimized(format) {
  // Gate: guests must log in to download
  if (!currentUser) {
    showToast('Create a free account to download your optimized resume.', 'info', {
      duration: 5000,
    });
    setTimeout(() => navigateTo('/signup'), 1400);
    return;
  }

  const bar = el('agent-download-bar');
  if (!bar) return;
  const scanId = getActiveScanId();
  if (!scanId) return;

  try {
    const query = new URLSearchParams({ format, template: getSelectedTemplate() });
    const density = getSelectedDensity();
    if (density) query.set('density', density);
    const res = await fetch(`/api/agent/download/${scanId}?${query.toString()}`);
    if (!res.ok) {
      const data = await res.json();
      if (data.upgrade) navigateTo('/pricing');
      else showToast(data.error || 'Download failed', 'error');
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `optimized-resume.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    showToast('Resume downloaded!', 'success');
    if (currentUser) await fetchUser();
  } catch {
    showToast('Download failed — please check your connection and try again.', 'error');
  }
}

function toggleStepBody(step) {
  const body = el(`agent-body-${step}`);
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
}

// ── Load Results ───────────────────────────────────────────────
async function loadResults(scanId, retryCount = 0) {
  const MAX_RETRIES = 8;
  const myToken = ++loadResultsToken; // Cancel any previous retry chains

  // Show a loading overlay on first attempt
  if (retryCount === 0) {
    // Deactivate ALL views — we'll activate the right one after data loads
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    let loadingEl = el('global-loading-overlay');
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.id = 'global-loading-overlay';
      loadingEl.style.cssText =
        'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:9999;flex-direction:column;gap:1rem';
      loadingEl.innerHTML = safeHtml(
        '<div class="loader"></div><p class="body-md" style="opacity:0.6">Loading your results...</p>'
      );
      document.body.appendChild(loadingEl);
    }
    loadingEl.style.display = 'flex';
  }

  const hideLoading = () => {
    const overlay = el('global-loading-overlay');
    if (overlay) overlay.style.display = 'none';
  };

  // --- Step 1: Try to get results ---
  let results = null;

  // Check in-memory cache first (from live SSE stream)
  if (currentScan && String(currentScan.id) === String(scanId)) {
    results = currentScan;
  } else {
    // Fetch from API
    try {
      const res = await fetch(buildScanApiUrl(scanId));
      if (res.ok) {
        const json = await res.json();
        results = json.results;
        if (results) {
          results.id = results.id || scanId;
          if (!results.access_token && !results.accessToken) {
            const persistedToken = getPersistedCurrentScanToken();
            if (persistedToken) results.accessToken = persistedToken;
          }
          currentScan = results;
          currentJobContext = getJobContext(results);
          currentRenderProfile = {
            template:
              results.renderMeta?.renderTemplate ||
              currentJobContext.templateProfile?.template ||
              'refined',
            density:
              results.renderMeta?.renderDensity ||
              currentJobContext.templateProfile?.defaultDensity ||
              'standard',
            atsPlatform: currentJobContext.atsPlatform || '',
            atsDisplayName: currentJobContext.atsDisplayName || '',
          };
        }
      } else if (retryCount < MAX_RETRIES) {
        console.log(
          `[loadResults] scan/${scanId} returned ${res.status}, retry ${retryCount + 1}/${MAX_RETRIES}`
        );
        await new Promise(r => setTimeout(r, 1000));
        if (loadResultsToken !== myToken) return; // Navigation happened, abort
        return loadResults(scanId, retryCount + 1);
      }
    } catch (e) {
      if (retryCount < MAX_RETRIES) {
        console.log(
          `[loadResults] scan/${scanId} network error, retry ${retryCount + 1}/${MAX_RETRIES}`
        );
        await new Promise(r => setTimeout(r, 1000));
        if (loadResultsToken !== myToken) return; // Navigation happened, abort
        return loadResults(scanId, retryCount + 1);
      }
    }
  }

  // --- Step 2: Show results or error ---
  hideLoading();

  if (!results) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    el('view-results').classList.add('active');
    // Show error in the dashboard area (results-content was removed in HTML restructure)
    const dashboard = el('results-dashboard');
    if (dashboard) {
      dashboard.style.display = 'block';
      dashboard.innerHTML = safeHtml(
        '<div class="card text-center" style="padding:3rem"><h3>Scan not found</h3><p class="body-sm" style="margin:1rem 0">This scan may have been deleted or doesn\'t exist.</p><button class="btn btn-primary" data-action="navigate" data-path="/scan">New Scan</button></div>'
      );
    }
    if (el('results-initializing')) el('results-initializing').style.display = 'none';
    return;
  }

  // --- Step 3: Populate Unified Dashboard ---
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el('view-results').classList.add('active');

  // Hide init block, show dashboard
  if (el('results-initializing')) el('results-initializing').style.display = 'none';
  if (el('results-dashboard')) el('results-dashboard').style.display = 'block';

  setupAgentHistoricalView(results);
}

function setupAgentHistoricalView(data) {
  const scanId = data.id || data.scanId;
  console.log('[AgentView] Initializing historical view for scan', scanId, data);
  currentJobContext = getJobContext(data);
  currentRenderProfile = {
    template:
      data.renderMeta?.renderTemplate || currentJobContext.templateProfile?.template || 'refined',
    density:
      data.renderMeta?.renderDensity ||
      currentJobContext.templateProfile?.defaultDensity ||
      'standard',
    atsPlatform: currentJobContext.atsPlatform || '',
    atsDisplayName: currentJobContext.atsDisplayName || '',
  };
  syncTemplateSelectionUI();
  updateResultsContextStrip(currentJobContext);
  const atsBadge = el('ats-platform-badge');
  if (atsBadge) {
    if (currentJobContext.atsDisplayName && currentJobContext.atsPlatform !== 'generic') {
      atsBadge.textContent = `Optimized for ${currentJobContext.atsDisplayName}`;
      atsBadge.style.display = 'inline-flex';
    } else {
      atsBadge.style.display = 'none';
    }
  }
  updateResultsWorkspaceHeader({ scan: data, source: 'history' });

  // 1. Dashboard + tabs visible
  const dashboard = el('results-dashboard');
  if (dashboard) dashboard.style.display = 'block';
  const tabMenu = el('results-tabs-menu');
  if (tabMenu) tabMenu.style.display = ''; // Let CSS (grid on mobile, flex on desktop) take over

  // 2. Configure PDF viewer overlays - ensure they're properly initialized
  const scanOverlay = el('pdf-scanning-overlay');
  const viewOverlay = el('pdf-viewer-overlay');
  if (scanOverlay) scanOverlay.style.display = 'none';
  if (viewOverlay) viewOverlay.style.display = 'none';

  // 2b. Mark all progress steps as complete (scan is finished)
  document.querySelectorAll('#agent-progress-bar .progress-step').forEach(step => {
    step.classList.remove('running', 'error');
    step.classList.add('complete');
  });

  // 3. Update Download Bar
  const bar = el('agent-download-bar');
  if (bar && scanId) {
    bar.dataset.scanId = scanId;
    bar.style.display = '';
  }

  // 4. Update Header Scores
  updateAgentScores({
    parseRate: data.parseRate ?? 0,
    formatHealth: data.formatHealth ?? 0,
    matchRate: data.matchRate ?? 0,
    matchRateAfter: data.matchRateAfter ?? null,
  });
  updateResultsSummary({ scores: data, scan: data });

  // 5. Populate Historical Timeline
  if (typeof renderAgentHistoricalTimeline === 'function') {
    renderAgentHistoricalTimeline(data);
  }

  // 6. Populate Recruiter View + Search Visibility
  renderRecruiterVisibility(data.xrayData || {}, data.keywordData || {});

  // 7b. Populate Cover Letter (if available from historical data)
  if (data.coverLetterText) {
    renderCoverLetter(data.coverLetterText);
  } else {
    const clContainer = el('cover-letter-content');
    const hasTargetJob = scanHasTargetJob(data, getJobContext(data));
    if (clContainer) {
      clContainer.innerHTML = safeHtml(`
        <div class="cover-letter-placeholder">
          <div style="display:flex;justify-content:center;margin-bottom:1rem;opacity:0.4">${uiIcon('mail', { size: 44, stroke: 1.6 })}</div>
          <h4>${hasTargetJob ? 'Cover letter preview unavailable' : 'No cover letter for this scan'}</h4>
          <p class="body-sm text-muted" style="margin-top:0.5rem">${
            hasTargetJob
              ? 'This scan has target-job context, but the cover-letter output was not usable. Start a fresh targeted scan to regenerate it.'
              : 'This scan only reviewed the resume structure. Add a target job link or paste the job description to generate a cover letter.'
          }</p>
        </div>
      `);
    }
    const clActions = el('cover-letter-actions');
    if (clActions) clActions.style.display = 'none';
  }

  // 8. Auto-load PDF preview (Only if optimized data exists)
  const isAgentScan = !!(
    data.optimizedResumeText ||
    (data.optimizedBullets && data.optimizedBullets.length > 0)
  );
  const renderMeta = data.renderMeta || {};

  if (isAgentScan && scanId) {
    // Use reloadPdfPreview for proper loading skeleton, error handling, and sizing
    reloadPdfPreview(scanId);
    if (viewOverlay) viewOverlay.style.display = 'flex';
    if (scanOverlay) scanOverlay.style.display = 'none';
  } else if (scanOverlay) {
    // Basic Scan or legacy record — explain why preview is unavailable
    scanOverlay.style.display = 'flex';
    scanOverlay.innerHTML = safeHtml(`
      <div style="display:flex;justify-content:center;margin-bottom:1.5rem">${uiIcon('spark', { size: 44, stroke: 1.8 })}</div>
      <h3 class="headline">${esc(
        renderMeta.renderStatus === 'failed'
          ? 'We could not build a reliable PDF preview'
          : 'Preview unavailable for this saved scan'
      )}</h3>
      <p class="body-sm text-muted" style="margin-top:1rem; max-width:360px; text-align:center">${esc(
        renderMeta.renderStatus === 'failed'
          ? renderMeta.renderError ||
              'The renderer could not produce a readable export for this older record. Run a fresh targeted scan to regenerate the preview.'
          : 'This older record does not include the optimized resume text we now use for the export preview. Run a fresh scan with a target job link or JD to generate the new preview.'
      )}</p>
      <button class="btn btn-primary" style="margin-top:2rem" data-action="navigate" data-path="/scan">Run New Targeted Scan</button>
    `);
    if (viewOverlay) viewOverlay.style.display = 'none';
  }

  // 9. Restore tab from sessionStorage (or default to ATS Diagnosis)
  const savedTab = sessionStorage.getItem('resumeXray_activeTab');
  if (savedTab && document.querySelector(`.results-tab-btn[data-tab="${savedTab}"]`)) {
    switchTab(savedTab);
  }
}

function renderAgentHistoricalTimeline(data) {
  const timeline = el('agent-timeline');
  if (!timeline) return;

  timeline.innerHTML = '';

  // SVG icon library for timeline cards
  const icons = {
    report:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    xray: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    warning:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    check:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    target:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    sparkle:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  };

  function createCard(iconSvg, accentColor, title, subtitle, bodyHtml, variant) {
    const card = document.createElement('div');
    card.className = `tl-card${variant ? ' tl-card--' + variant : ''}`;
    card.innerHTML = safeHtml(`
      <div class="tl-card-accent" style="background:${accentColor}"></div>
      <div class="tl-card-icon" style="background:${accentColor}15;color:${accentColor}">${iconSvg}</div>
      <div class="tl-card-content">
        <div class="tl-card-title">${title}</div>
        ${subtitle ? `<div class="tl-card-subtitle">${subtitle}</div>` : ''}
        ${bodyHtml ? `<div class="tl-card-body">${bodyHtml}</div>` : ''}
      </div>
    `);
    return card;
  }

  // 1. Analysis Report Header
  const scanDate = new Date(data.createdAt || Date.now()).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  timeline.appendChild(
    createCard(
      icons.report,
      'var(--accent)',
      `Analysis Report: ${esc(data.jobTitle || 'General Analysis')}`,
      `Scan completed on ${scanDate}`,
      null,
      null
    )
  );

  // 2. Section Coverage (X-Ray)
  const xray = data.xrayData || {};
  const sections = xray.extractedFields || {};
  const foundSections = Object.keys(sections).filter(
    k => sections[k] && sections[k].toString().trim().length > 0
  );

  if (foundSections.length > 0) {
    const sectionPills = foundSections.map(s => `<span class="tl-tag">${esc(s)}</span>`).join('');
    timeline.appendChild(
      createCard(
        icons.xray,
        'var(--blue)',
        `Database Indexing: ${foundSections.length} Core Sections Detected`,
        null,
        `<div class="tl-tags">${sectionPills}</div>`,
        null
      )
    );
  }

  // 3. Formatting Risks
  const issues = data.formatIssues || [];
  if (issues.length > 0) {
    const issueList = issues.map(i => `<li>${esc(i.title || i)}</li>`).join('');
    timeline.appendChild(
      createCard(
        icons.warning,
        'var(--red)',
        `${issues.length} Formatting Risk${issues.length > 1 ? 's' : ''} Identified`,
        null,
        `<ul class="tl-issue-list">${issueList}</ul>`,
        'danger'
      )
    );
  } else {
    timeline.appendChild(
      createCard(
        icons.check,
        'var(--green)',
        'ATS Parsing Integrity: 100%',
        'No significant formatting errors or parsing hurdles detected.',
        null,
        'success'
      )
    );
  }

  // 4. Job Match Insights
  if (data.matchRate !== undefined) {
    const rate = Math.round(data.matchRate);
    const level = rate > 70 ? 'strong' : rate > 40 ? 'moderate' : 'low';
    const color = rate > 70 ? 'var(--green)' : rate > 40 ? 'var(--amber)' : 'var(--red)';
    timeline.appendChild(
      createCard(
        icons.target,
        color,
        `JD Semantic Score: ${rate}%`,
        `Your profile has a ${level} alignment with this role.`,
        `<div class="tl-progress-bar"><div class="tl-progress-fill" style="width:${rate}%;background:${color}"></div></div>`,
        null
      )
    );
  }

  // 5. AI Optimization Summary
  const bullets = data.optimizedBullets || [];
  if (bullets.length > 0) {
    timeline.appendChild(
      createCard(
        icons.sparkle,
        'var(--purple)',
        'Premium Optimizations Applied',
        `${bullets.length} experience bullet${bullets.length > 1 ? 's were' : ' was'} re-engineered for higher impact using the CAR formula.`,
        null,
        'premium'
      )
    );
  }
}

// ── Dashboard ──────────────────────────────────────────────────
async function renderDashboard() {
  if (!currentUser) return;

  // Refresh user data for latest usage stats
  await fetchUser();
  const user = currentUser?.user;
  const creditBalance = user?.creditBalance || 0;

  // Populate credit balance stats
  if (el('stat-scans-bento')) {
    el('stat-scans-bento').textContent = '∞ Free';
    el('progress-scans').style.width = '100%';
  }

  if (el('stat-resumes-bento')) {
    const scansUsed = user?.scansUsed || 0;
    el('stat-resumes-bento').textContent = scansUsed;
    el('progress-resumes').style.width = scansUsed > 0 ? Math.min(100, scansUsed * 10) + '%' : '0%';
  }

  // Show tier name
  const tier = user?.tier || 'free';
  const tierNames = { free: 'FREE', starter: 'STARTER', pro: 'PRO', hustler: 'CAREER PLUS' };
  if (el('dash-plan-bento')) {
    const tierClass = tier === 'free' ? 'tier-free' : 'tier-pro';
    el('dash-plan-bento').innerHTML = safeHtml(
      `<span id="dash-tier-badge" class="dash-tier-badge ${tierClass}">${tierNames[tier]}</span> ${esc(creditBalance)} credits`
    );
  }

  // Update Manage Button — consistent text
  const manageBtn = el('dash-manage-btn');
  if (manageBtn) {
    manageBtn.innerHTML = safeHtml(
      `<button class="btn btn-primary btn-sm" data-action="navigate" data-path="/pricing">Get More Credits →</button>`
    );
  }

  // Fetch History
  try {
    const res = await fetch('/user/dashboard');
    if (!res.ok) return;
    const data = await res.json();
    updateDashboardFocus(data, user);

    // Update Last Score Card
    if (data.scans?.length > 0) {
      const last = data.scans[0];
      el('stat-last-score').textContent = Math.round(last.match_rate || 0) + '%';
      const lastTitle = getDashboardScanTitle(last);
      el('stat-last-title').textContent =
        lastTitle.substring(0, 30) + (lastTitle.length > 30 ? '…' : '');
      el('stat-last-title').title = lastTitle;
      el('stat-last-title').innerHTML += safeHtml(
        `<div class="body-xs" style="opacity:0.4;margin-top:2px">${timeAgo(last.created_at)}</div>`
      );
    }

    const list = el('dash-scans-list');
    if (!list) return;

    if (!data.scans?.length) {
      list.innerHTML = safeHtml(`
        <div class="empty-state card bento-glass text-center" style="padding:3rem">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin:0 auto 1rem"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <p style="font-weight:700;margin-bottom:0.5rem">Start with one target role</p>
          <p class="body-sm" style="opacity:0.82;margin-bottom:1.25rem">Upload a resume and job description to unlock recruiter-view feedback, keyword gaps, and export-ready recommendations.</p>
          <button class="btn btn-primary" data-action="navigate" data-path="/scan">Start First Scan</button>
        </div>`);
    } else {
      list.innerHTML = safeHtml(
        data.scans
          .map(s => {
            const parse = Math.round(s.parse_rate || 0);
            const match = Math.round(s.match_rate || 0);
            const best = Math.max(parse, match);
            const borderColor =
              best >= 80 ? 'var(--green)' : best >= 50 ? 'var(--amber)' : 'var(--red)';
            const title = getDashboardScanTitle(s);

            const displayTitle = title.length > 65 ? title.substring(0, 65) + '…' : title;

            return `
        <a class="card scan-history-card animate-fade-up" href="/results/${esc(s.id)}" data-link aria-label="View scan results for ${esc(title)}" style="margin-bottom:1rem; border-left:3px solid ${borderColor}; padding: 1.25rem;">
          <div class="flex justify-between items-center gap-4">

            <div style="flex: 1; min-width: 0;">
              <h4 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin: 0 0 0.5rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${esc(title)}">
                ${esc(displayTitle)}
              </h4>

              <div style="display:flex; gap:0.5rem; align-items: center; flex-wrap:wrap;">
                ${scoreBadge(parse, 'Parse')}
                ${s.match_rate != null ? scoreBadge(match, 'Match') : ''}

                <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 0.5rem; display: flex; align-items: center; gap: 4px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  ${timeAgo(s.created_at)}
                </span>
              </div>
            </div>

            <div style="color: var(--text-muted); transition: transform 0.2s ease;" class="history-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>

          </div>
        </a>`;
          })
          .join('')
      );
    }
  } catch {
    const list = el('dash-scans-list');
    if (list)
      list.innerHTML = safeHtml(
        '<div class="card" style="padding:1.5rem;text-align:center;opacity:0.6">Couldn\'t load scan history. Please refresh the page.</div>'
      );
  }
}

function updateDashboardFocus(data, user) {
  const scans = Array.isArray(data?.scans) ? data.scans : [];
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const resumes = Array.isArray(data?.resumes) ? data.resumes : [];
  const latest = scans[0] || null;
  const creditBalance = data?.creditBalance ?? user?.creditBalance ?? 0;
  const targetedScanCount = scans.filter(scan => scanHasTargetJob(scan, getJobContext(scan))).length;

  const titleEl = el('dash-next-step-title');
  const bodyEl = el('dash-next-step-body');
  const btnEl = el('dash-next-step-btn');
  const metaEl = el('dash-next-step-meta');
  const targetEl = el('dash-focus-target');
  const targetSubEl = el('dash-focus-target-sub');
  const jobsCountEl = el('dash-jobs-count');
  const momentumEl = el('dash-momentum-note');

  if (jobsCountEl) jobsCountEl.textContent = String(targetedScanCount);

  const latestTitle = latest ? getDashboardScanTitle(latest) : 'No recent target yet';

  if (targetEl) targetEl.textContent = latestTitle;
  if (targetSubEl) {
    targetSubEl.textContent = latest
      ? `${Math.round(latest.match_rate || 0)}% match · ${timeAgo(latest.created_at)}`
      : 'Your latest scan will appear here with recruiter-facing context.';
  }

  if (momentumEl) {
    if (!scans.length) {
      momentumEl.textContent = 'Build one strong scan first, then export when the recruiter view looks clean.';
    } else if (targetedScanCount > 0) {
      momentumEl.textContent = `You have ${targetedScanCount} targeted scan${targetedScanCount === 1 ? '' : 's'} ready for follow-up and export review.`;
    } else {
      momentumEl.textContent = 'Run a targeted scan against a live job link or pasted JD to build a stronger benchmark before exporting.';
    }
  }

  const recommendation = getDashboardRecommendation({ scans, jobs, resumes, creditBalance });
  if (titleEl) titleEl.textContent = recommendation.title;
  if (bodyEl) bodyEl.textContent = recommendation.body;
  if (metaEl) metaEl.textContent = recommendation.meta;
  if (btnEl) {
    btnEl.textContent = recommendation.cta;
    btnEl.setAttribute('data-action', 'navigate');
    btnEl.setAttribute('data-path', recommendation.path);
  }
}

function updateDashboardJourney(data, user) {
  const scans = Array.isArray(data?.scans) ? data.scans : [];
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const resumes = Array.isArray(data?.resumes) ? data.resumes : [];
  const latest = scans[0] || null;
  const creditBalance = data?.creditBalance ?? user?.creditBalance ?? 0;

  const targetBodyEl = el('dash-journey-target-body');
  const reviewBodyEl = el('dash-journey-review-body');
  const exportBodyEl = el('dash-journey-export-body');
  const winTitleEl = el('dash-win-title');
  const winBodyEl = el('dash-win-body');
  const winMetaEl = el('dash-win-meta');

  const targetState = latest ? 'complete' : 'current';
  const reviewState = latest ? (latest.match_rate >= 70 || latest.parse_rate >= 75 ? 'complete' : 'current') : 'pending';
  const exportState =
    latest && creditBalance > 0 && (latest.match_rate || 0) >= 75 && (latest.parse_rate || 0) >= 75
      ? 'complete'
      : creditBalance > 0
        ? 'current'
        : 'pending';

  setJourneyItemState('dash-journey-target', targetState);
  setJourneyItemState('dash-journey-review', reviewState);
  setJourneyItemState('dash-journey-export', exportState);

  if (targetBodyEl) {
    targetBodyEl.textContent = latest
      ? `Latest focus: ${getDashboardScanTitle(latest)}`
      : 'Run one scan against a live job description so the feedback stays specific.';
  }
  if (reviewBodyEl) {
    reviewBodyEl.textContent = latest
      ? 'Open the latest results and confirm which fields stay visible to recruiter searches.'
      : 'Once a scan exists, use recruiter visibility to decide which fixes matter most.';
  }
  if (exportBodyEl) {
    exportBodyEl.textContent =
      creditBalance > 0
        ? `${creditBalance} credit${creditBalance === 1 ? '' : 's'} ready once the latest scan feels send-ready.`
        : 'Keep one credit ready so a polished result can turn into a same-day application.';
  }

  if (!winTitleEl || !winBodyEl || !winMetaEl) return;

  if (!latest) {
    winTitleEl.textContent = 'Your first scan becomes the benchmark for everything that follows';
    winBodyEl.textContent =
      'Once you analyze one real target role, this panel turns into a live application brief with the strongest next move.';
    winMetaEl.textContent = 'No recent scans yet';
    return;
  }

  const matchRate = Math.round(latest.match_rate || 0);
  const parseRate = Math.round(latest.parse_rate || 0);
  if (matchRate >= 80 && parseRate >= 80) {
    winTitleEl.textContent = 'The latest scan is already close to application-ready';
    winBodyEl.textContent =
      'You have enough signal to do a final recruiter-view pass, then export while the role is still fresh.';
  } else if (matchRate >= 60 || parseRate >= 70) {
    winTitleEl.textContent = 'The latest scan has a workable foundation';
    winBodyEl.textContent =
      'You are past generic resume review. One more targeted pass should lift visibility and confidence before export.';
  } else {
    winTitleEl.textContent = 'The latest scan exposed the clearest improvement path';
    winBodyEl.textContent =
      'Use this gap as leverage: cleaner parsing and sharper role language will create the biggest jump in visibility.';
  }

  const metaParts = [
    getDashboardScanTitle(latest),
    `${matchRate}% match`,
    `${parseRate}% parse`,
    jobs.length ? `${jobs.length} saved job${jobs.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  winMetaEl.textContent = metaParts.join(' · ');
}

function setJourneyItemState(id, state) {
  const item = el(id);
  if (!item) return;
  item.classList.remove('is-pending', 'is-current', 'is-complete');
  item.classList.add(`is-${state}`);
}

function getDashboardRecommendation({ scans, jobs, resumes, creditBalance }) {
  const latest = scans[0];

  if (!latest) {
    return {
      title: 'Run your first targeted scan',
      body: 'Upload your latest resume and a real job description to unlock recruiter visibility, keyword coverage, and rewrite suggestions in one pass.',
      cta: 'Start First Scan',
      path: '/scan',
      meta: 'You will get a recruiter-view benchmark before spending a single credit.',
    };
  }

  if (creditBalance < 1) {
    return {
      title: 'Keep one export credit ready',
      body: 'Your recruiter feedback is already flowing. Add a credit now so you can export the minute this resume is ready to send.',
      cta: 'Get More Credits',
      path: '/pricing',
      meta: `Latest target: ${getDashboardScanTitle(latest)}`,
    };
  }

  if (!latest.job_url && !(latest.job_description || '').trim()) {
    return {
      title: 'Add a real job target to sharpen the scan',
      body: 'Generic scans help, but the strongest recommendations appear when you include a job link or pasted description.',
      cta: 'Start Targeted Scan',
      path: '/scan',
      meta: 'Targeted scans improve match feedback and cover letter quality.',
    };
  }

  if (jobs.length < 1 && resumes.length < 2) {
    return {
      title: 'Build a second benchmark before exporting',
      body: 'Compare one more role or resume version so you know which changes actually improve recruiter visibility.',
      cta: 'Scan Another Version',
      path: '/scan',
      meta: `Latest scan: ${getDashboardScanTitle(latest)}`,
    };
  }

  return {
    title: 'Review the latest recruiter gaps',
    body: 'Open your newest scan and tighten any missing fields or weak match areas before you export the final version.',
    cta: 'Open Latest Scan',
    path: `/results/${latest.id}`,
    meta: `Updated ${timeAgo(latest.created_at)} · ${Math.round(latest.match_rate || 0)}% current match`,
  };
}

function isNoisyJobFacingTitle(title = '') {
  const clean = decodeHtml(String(title || '').trim());
  if (!clean) return true;
  if (clean.length > 90) return true;
  if (clean.split(/\s+/).length > 9) return true;
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(clean)) return true;
  if (
    /^(provide|responsible|join|working|support|ensure|maintain|this|we|you|our|the)\b/i.test(
      clean
    )
  ) {
    return true;
  }
  return false;
}

function extractTitleFromJobUrl(jobUrl = '') {
  try {
    const url = new URL(jobUrl);
    const host = url.hostname.replace(/^www\./, '');
    const segments = url.pathname.split('/').filter(Boolean);
    const slug = segments[segments.length - 1] || '';
    const cleaned = slug
      .replace(/[-_]?\d{5,}$/, '')
      .replace(/[-_]+/g, ' ')
      .trim();

    if (cleaned.length >= 4 && cleaned.length < 80 && !/^(apply|job|jobs|view)$/i.test(cleaned)) {
      return cleaned.replace(/\b\w/g, c => c.toUpperCase()).replace(/\bAt\b/g, 'at');
    }

    if (!/(linkedin|indeed|greenhouse|lever|workday|naukri|glassdoor|smartrecruiters|icims|cezannehr)\./i.test(host)) {
      return host;
    }
  } catch {
    /* ignore invalid URL */
  }
  return '';
}

function getDashboardScanTitle(scan) {
  const jobContext = getJobContext(scan);
  let title = decodeHtml(jobContext.jobTitle || scan.job_title || '');
  const company = decodeHtml(jobContext.companyName || scan.company_name || '');

  if (isNoisyJobFacingTitle(title) || title.toLowerCase() === 'no job description') {
    title = extractTitleFromJobUrl(jobContext.jobUrl || scan.job_url || '');
  }

  if (!title || isNoisyJobFacingTitle(title) || title.toLowerCase() === 'no job description') {
    if (company) return `Role at ${company}`;
    if (scan.job_description && scan.job_description.trim()) return 'Pasted Job Description';
    return 'Resume-only Scan';
  }

  if (company && !title.toLowerCase().includes(company.toLowerCase())) {
    title = `${title}, ${company}`;
  }

  return title;
}

async function renderProfile() {
  if (!currentUser) return;
  await fetchUser();
  const user = currentUser.user;
  const creditBalance = user.creditBalance || 0;
  const tier = user.tier || 'free';

  el('profile-name').textContent = user.name;
  el('profile-email').textContent = user.email;
  el('profile-joined').textContent = new Date(user.joinedAt || Date.now()).toLocaleDateString(
    'en-US',
    { month: 'long', year: 'numeric' }
  );

  // Tier badge
  const tierNames = { free: 'Free', starter: 'Starter', pro: 'Professional', hustler: 'Career Plus' };
  const badge = el('profile-tier-badge');
  badge.textContent = tierNames[tier] || 'Free';
  badge.className = `tier-badge tier-${tier}`;
  updateProfileGuidance(user, creditBalance);
  updateProfileMomentum(user, creditBalance);

  // Credit balance
  el('profile-credit-count').textContent = creditBalance;
  const creditBar = el('profile-credit-bar');
  if (creditBar) {
    const maxCredits = tier === 'hustler' ? 50 : tier === 'pro' ? 15 : tier === 'starter' ? 5 : 1;
    creditBar.style.width = Math.min(100, (creditBalance / maxCredits) * 100) + '%';
  }

  // ── Verified Badge ────────────────────────────────────────────
  const verifiedBadge = el('profile-verified-badge');
  if (verifiedBadge) {
    verifiedBadge.style.display = user.isVerified ? 'inline-flex' : 'none';
  }

  // ── Email Verification Banner (unverified email/password users only) ──
  const verifyBanner = el('verify-email-banner');
  if (verifyBanner) {
    const isOAuthUser = !!user.provider;
    verifyBanner.style.display = !user.isVerified && !isOAuthUser ? 'flex' : 'none';
  }

  // Resend verification email button
  const resendBtn = el('btn-resend-verification');
  if (resendBtn && !resendBtn._bound) {
    resendBtn._bound = true;
    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Sending...';
      try {
        if (!_csrfToken) await fetchCsrfToken();
        const res = await fetch('/auth/resend-verification', {
          method: 'POST',
          headers: _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {},
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Verification email sent! Check your inbox.', 'success');
          resendBtn.textContent = 'Sent';
        } else {
          showToast(data.error || 'Failed to resend.', 'error');
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend Email';
        }
      } catch {
        showToast('Failed to send. Check your connection.', 'error');
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Email';
      }
    });
  }

  const primaryActionBtn = el('profile-primary-action');
  if (primaryActionBtn && !primaryActionBtn._bound) {
    primaryActionBtn._bound = true;
    primaryActionBtn.addEventListener('click', () => {
      const action = primaryActionBtn.dataset.profileAction;
      if (action === 'resend-verification') {
        resendBtn?.click();
        return;
      }

      const path = primaryActionBtn.dataset.path;
      if (path) navigateTo(path);
    });
  }

  // ── OAuth Provider Badges ─────────────────────────────────────
  const providerBadgesEl = el('profile-provider-badges');
  if (providerBadgesEl && user.provider) {
    const providerInfo = {
      google: { label: 'Google Connected', color: '#ea4335' },
      linkedin: { label: 'LinkedIn Connected', color: '#0a66c2' },
      github: { label: 'GitHub Connected', color: '#6e5494' },
    };
    const info = providerInfo[user.provider];
    if (info) {
      providerBadgesEl.style.display = 'flex';
      providerBadgesEl.innerHTML = safeHtml(`
        <span class="provider-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          ${esc(info.label)}
        </span>`);
    }
  }

  // ── Hide password section for OAuth-only users ────────────────
  const passwordSection = el('password-section');
  if (passwordSection) {
    // Users with no password_hash are OAuth-only — password management doesn't apply
    passwordSection.style.display = user.hasPassword ? 'block' : 'none';
  }

  // Avatar (safe DOM construction — no innerHTML to prevent XSS)
  const avatarEl = el('profile-avatar');
  if (user.avatar && user.avatar !== 'null') {
    const img = document.createElement('img');
    img.src = user.avatar;
    img.alt = user.name || 'Avatar';
    avatarEl.textContent = '';
    avatarEl.appendChild(img);
  }

  // Avatar upload — uses FormData to match the multer middleware on the server
  const avatarInput = el('avatar-file-input');
  if (avatarInput) {
    avatarInput.onchange = async () => {
      if (!avatarInput.files.length) return;
      const file = avatarInput.files[0];

      // Client-side size check before the round trip
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image must be under 5MB.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('avatar', file);
      try {
        const res = await fetch('/user/avatar', {
          method: 'PUT',
          body: formData, // Let browser set Content-Type multipart/form-data automatically
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        if (data.avatarUrl) {
          const img = document.createElement('img');
          img.src = data.avatarUrl;
          img.alt = 'Avatar';
          avatarEl.textContent = '';
          avatarEl.appendChild(img);
          showToast('Avatar updated!', 'success');
        }
      } catch (err) {
        showToast(
          err.message || 'Unable to upload avatar. Please try a smaller JPEG or PNG.',
          'error'
        );
      }
    };
  }

  // Credit history
  try {
    const res = await fetch('/user/credit-history');
    if (res.ok) {
      const data = await res.json();
      const histEl = el('profile-credit-history');
      if (data.history && data.history.length > 0) {
        histEl.innerHTML = safeHtml(
          data.history
            .map(
              h => `
          <div class="credit-history-row">
            <div>
              <div style="font-weight:500">${esc(h.description || h.type)}</div>
              <div class="body-xs" style="color:var(--text-muted)">${timeAgo(h.created_at)}</div>
            </div>
            <div class="${h.amount > 0 ? 'credit-amount-pos' : 'credit-amount-neg'}">
              ${h.amount > 0 ? '<span class="credit-label">Earned</span> +' : '<span class="credit-label">Used</span> '}${h.amount}
            </div>
          </div>
        `
            )
            .join('')
        );
      } else {
        histEl.innerHTML = safeHtml(`
          <div style="text-align:center;padding:1.5rem 0;opacity:0.5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 0.5rem;display:block;opacity:0.4"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            <p class="body-sm">Credits appear here when you purchase or use them</p>
          </div>`);
      }
    }
  } catch {
    const histEl = el('profile-credit-history');
    if (histEl)
      histEl.innerHTML = safeHtml(
        '<p class="body-sm" style="color:var(--text-muted)">Couldn\'t load credit history.</p>'
      );
  }

  // Password change modal
  const pwBtn = el('btn-change-password');
  if (pwBtn) {
    pwBtn.onclick = () => {
      el('password-modal').style.display = 'flex';
      document.body.classList.add('modal-open');
      // Setup strength indicator for the profile pw modal
      _setupPasswordStrength('pw-new', 'profile');
    };
  }
  const pwCancel = el('pw-cancel');
  if (pwCancel)
    pwCancel.onclick = () => {
      el('password-modal').style.display = 'none';
      document.body.classList.remove('modal-open');
      // Reset the strength indicator state
      const container = el('profile-pw-strength');
      if (container) container.classList.remove('visible');
    };
  const pwForm = el('password-form');
  if (pwForm) {
    pwForm.onsubmit = async e => {
      e.preventDefault();
      const errEl = el('pw-error');
      errEl.style.display = 'none';
      try {
        const res = await fetch('/user/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: el('pw-current').value,
            newPassword: el('pw-new').value,
          }),
        });
        const data = await res.json();
        if (data.error) {
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        } else {
          el('password-modal').style.display = 'none';
          document.body.classList.remove('modal-open');
          showToast('Password updated!', 'success');
          pwForm.reset();
        }
      } catch {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
      }
    };
  }

  // Delete account modal
  const delBtn = el('btn-delete-account');
  if (delBtn)
    delBtn.onclick = () => {
      el('delete-modal').style.display = 'flex';
      document.body.classList.add('modal-open');
    };
  const delCancel = el('delete-cancel');
  if (delCancel)
    delCancel.onclick = () => {
      el('delete-modal').style.display = 'none';
      document.body.classList.remove('modal-open');
    };
  const delForm = el('delete-form');
  if (delForm) {
    delForm.onsubmit = async e => {
      e.preventDefault();
      const errEl = el('delete-error');
      errEl.style.display = 'none';
      try {
        const res = await fetch('/user/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmEmail: el('delete-confirm-email').value }),
        });
        const data = await res.json();
        if (data.error) {
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        } else {
          currentUser = null;
          showToast('Account deleted', 'success');
          navigateTo('/');
          location.reload();
        }
      } catch {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
      }
    };
  }
}

function updateProfileGuidance(user, creditBalance) {
  const readinessTitleEl = el('profile-readiness-title');
  const readinessBodyEl = el('profile-readiness-body');
  const securityTitleEl = el('profile-security-title');
  const securityBodyEl = el('profile-security-body');
  const exportTitleEl = el('profile-export-title');
  const exportBodyEl = el('profile-export-body');

  const providerLabel = user.provider
    ? `${user.provider.charAt(0).toUpperCase()}${user.provider.slice(1)} sign-in`
    : 'Email and password sign-in';

  if (readinessTitleEl && readinessBodyEl) {
    if (!user.isVerified && !user.provider) {
      readinessTitleEl.textContent = 'Verify your account before export day';
      readinessBodyEl.textContent =
        'Your welcome credit unlocks after verification, and verifying now avoids delays when you are ready to send.';
    } else if (creditBalance < 1) {
      readinessTitleEl.textContent = 'Your account is ready but credits are empty';
      readinessBodyEl.textContent =
        'Scans stay free, but you will need at least one credit available when you want the final export.';
    } else {
      readinessTitleEl.textContent = 'You are ready to export when the scan looks clean';
      readinessBodyEl.textContent =
        'Verification, credits, and account access are all in place, so the next gating factor is scan quality.';
    }
  }

  if (securityTitleEl && securityBodyEl) {
    securityTitleEl.textContent = user.hasPassword ? 'Password protection is enabled' : providerLabel;
    securityBodyEl.textContent = user.hasPassword
      ? 'You can update your password here before a busy application week so you are not locked out at the wrong moment.'
      : 'This account uses connected sign-in only, so access depends on your external provider staying available.';
  }

  if (exportTitleEl && exportBodyEl) {
    if (creditBalance > 0) {
      exportTitleEl.textContent = `${creditBalance} credit${creditBalance === 1 ? '' : 's'} ready for export`;
      exportBodyEl.textContent =
        'Use credits only when the resume or cover letter feels complete. Until then, keep scanning and rewriting for free.';
    } else {
      exportTitleEl.textContent = 'Keep one export credit ready';
      exportBodyEl.textContent =
        'Adding a small credit buffer now removes friction when a recruiter response forces a same-day application.';
    }
  }
}

function updateProfileMomentum(user, creditBalance) {
  const titleEl = el('profile-momentum-title');
  const bodyEl = el('profile-momentum-body');
  const primaryBtn = el('profile-primary-action');
  if (!titleEl || !bodyEl || !primaryBtn) return;

  if (!user.isVerified && !user.provider) {
    titleEl.textContent = 'Unlock your welcome credit before application week';
    bodyEl.textContent =
      'Verify your email now so credits and recovery are already in place when a role becomes urgent.';
    primaryBtn.textContent = 'Resend Verification Email';
    primaryBtn.dataset.profileAction = 'resend-verification';
    delete primaryBtn.dataset.path;
    return;
  }

  if (creditBalance < 1) {
    titleEl.textContent = 'Keep one export credit ready';
    bodyEl.textContent =
      'Scans and rewrites stay free. The only remaining friction is having a credit ready when the resume is strong enough to send.';
    primaryBtn.textContent = 'Buy Credits';
    primaryBtn.dataset.profileAction = 'navigate';
    primaryBtn.dataset.path = '/pricing';
    return;
  }

  titleEl.textContent = 'Your account is ready for fast application turns';
  bodyEl.textContent =
    'Credits, verification, and account access are in good shape, so the next move is reviewing the latest scan and exporting at the right moment.';
  primaryBtn.textContent = 'Open Dashboard';
  primaryBtn.dataset.profileAction = 'navigate';
  primaryBtn.dataset.path = '/dashboard';
}

function renderPricing() {
  // Credit packs are static — no plan-based logic needed
  // Just ensure buttons work
  document.querySelectorAll('.pricing-card').forEach(card => {
    const btn = card.querySelector('button');
    if (btn) btn.disabled = false;
  });
}

// ── Build Recruiter Table ──────────────────────────────────────
function normalizeRecruiterFieldValue(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s([,.;:])/g, '$1')
    .trim();
}

function formatRecruiterFieldName(fieldName) {
  const normalized = String(fieldName || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  const aliases = {
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    'phone number': 'Phone',
    linkedin: 'LinkedIn',
    'linkedin url': 'LinkedIn URL',
    summary: 'Summary',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    location: 'Location',
    address: 'Location',
    portfolio: 'Portfolio',
    website: 'Website',
  };
  if (aliases[normalized]) return aliases[normalized];
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

function getRecruiterFieldEntries(fieldAccuracy = {}, extractedFields = {}) {
  const fields =
    Object.keys(fieldAccuracy).length > 0
      ? Object.keys(fieldAccuracy)
      : Object.keys(extractedFields);
  const priority = [
    'name',
    'email',
    'phone',
    'location',
    'linkedin',
    'portfolio',
    'summary',
    'experience',
    'education',
    'skills',
  ];

  const scoreField = fieldName => {
    const normalized = String(fieldName || '').toLowerCase();
    const index = priority.findIndex(key => normalized.includes(key));
    return index === -1 ? priority.length + 1 : index;
  };

  return fields
    .slice()
    .sort((left, right) => {
      const scoreDiff = scoreField(left) - scoreField(right);
      if (scoreDiff !== 0) return scoreDiff;
      return formatRecruiterFieldName(left).localeCompare(formatRecruiterFieldName(right));
    })
    .map(fieldName => {
      const info = fieldAccuracy[fieldName] || {};
      const rawValue = info.value || extractedFields[fieldName] || '';
      const status = info.status || (rawValue ? 'success' : 'missing');
      const isMissing = !rawValue || String(rawValue).includes('[Parser could not extract');

      return {
        fieldName,
        label: formatRecruiterFieldName(fieldName),
        status: isMissing ? 'missing' : status,
        rawValue,
      };
    });
}

function summarizeRecruiterField(fieldName, rawValue) {
  const cleaned = normalizeRecruiterFieldValue(rawValue);
  if (!cleaned) return null;

  const compactList = cleaned
    .split(/\s*[•\n|,;]\s*/g)
    .map(item => item.trim())
    .filter(Boolean);

  switch (String(fieldName || '').toLowerCase()) {
    case 'experience': {
      const highlights = compactList.slice(0, 4);
      return {
        title: `${highlights.length || 1} experience signal${highlights.length === 1 ? '' : 's'} captured`,
        detail: truncate(highlights.join(' · ') || cleaned, 180),
      };
    }
    case 'skills': {
      const uniqueSkills = [...new Set(compactList.map(item => item.replace(/\s{2,}/g, ' ')))];
      return {
        title: `${uniqueSkills.length || 1} skill keyword${uniqueSkills.length === 1 ? '' : 's'} captured`,
        detail: truncate(uniqueSkills.slice(0, 10).join(' · '), 180),
      };
    }
    case 'education': {
      const schools = compactList.slice(0, 3);
      return {
        title: `${schools.length || 1} education entr${schools.length === 1 ? 'y' : 'ies'} captured`,
        detail: truncate(schools.join(' · ') || cleaned, 180),
      };
    }
    case 'summary':
      return {
        title: 'Professional summary captured',
        detail: truncate(cleaned, 180),
      };
    default:
      return {
        title: truncate(cleaned, 110),
        detail: cleaned.length > 110 ? truncate(cleaned, 180) : 'Searchable value extracted for recruiter review.',
      };
  }
}

function buildRecruiterRows(fieldAccuracy, extractedFields) {
  const entries = getRecruiterFieldEntries(fieldAccuracy, extractedFields);
  if (entries.length === 0) {
    return `<div class="recruiter-empty-state">
      <div class="recruiter-empty-icon">${uiIcon('archive', { size: 40, stroke: 1.5 })}</div>
      <h4>Parser data unavailable</h4>
      <p>This scan record does not contain structured recruiter field data yet.</p>
    </div>`;
  }

  const isGuest = !currentUser;

  // Mask sensitive PII fields for non-logged-in users on shared/public links only.
  // On a user's own just-ran scan, show full values so they can verify parsing.
  function maskValue(fieldName, value) {
    // Never mask for logged-in users or the user's own scan session
    if (!isGuest) return value;
    if (value == null) return value;
    const f = String(fieldName || '').toLowerCase();
    const sensitiveKeys = [
      'email',
      'phone',
      'phone_number',
      'ssn',
      'ssn_number',
      'address',
      'postal',
      'birthday',
      'date_of_birth',
    ];
    // Mask only known sensitive fields or any field with a likely personal data hint
    const isSensitive = sensitiveKeys.some(k => f.includes(k));
    if (isSensitive || /email|phone|ssn/.test(f)) {
      const s = String(value);
      if (s.length <= 4) return '*'.repeat(s.length);
      return '*'.repeat(Math.max(0, s.length - 4)) + s.slice(-4);
    }
    return value;
  }

  return entries
    .map(entry => {
      const maskedValue = maskValue(entry.fieldName, String(entry.rawValue || ''));
      const summary = entry.rawValue
        ? summarizeRecruiterField(entry.fieldName, maskedValue)
        : null;
      const statusLabel =
        entry.status === 'success' ? 'Captured' : entry.status === 'warning' ? 'Partial' : 'Missing';
      const toneClass =
        entry.status === 'success'
          ? 'is-found'
          : entry.status === 'warning'
            ? 'is-partial'
            : 'is-missing';

      return `<article class="recruiter-signal-card ${toneClass}">
        <div class="recruiter-signal-header">
          <div class="recruiter-signal-copy">
            <span class="recruiter-signal-label">${esc(entry.label)}</span>
            <h3 class="recruiter-signal-title">${
              summary ? esc(summary.title) : 'No recruiter-searchable value mapped yet'
            }</h3>
          </div>
          <span class="recruiter-signal-status">${esc(statusLabel)}</span>
        </div>
        <p class="recruiter-signal-detail">${
          summary
            ? esc(summary.detail)
            : 'This field is missing or inconsistent enough that the parser cannot trust it for recruiter search.'
        }</p>
      </article>`;
    })
    .join('');
}

function buildRecruiterOverview(fieldAccuracy = {}, extractedFields = {}) {
  const entries = getRecruiterFieldEntries(fieldAccuracy, extractedFields);
  if (!entries.length) {
    return `<div class="recruiter-overview-empty">No recruiter field map yet</div>`;
  }

  const foundCount = entries.filter(entry => entry.status === 'success').length;
  const partialCount = entries.filter(entry => entry.status === 'warning').length;
  const missingCount = entries.length - foundCount - partialCount;

  return `
    <div class="recruiter-overview-stat is-found">
      <span class="recruiter-overview-label">Captured</span>
      <strong class="recruiter-overview-value">${foundCount}</strong>
    </div>
    <div class="recruiter-overview-stat is-partial">
      <span class="recruiter-overview-label">Partial</span>
      <strong class="recruiter-overview-value">${partialCount}</strong>
    </div>
    <div class="recruiter-overview-stat is-missing">
      <span class="recruiter-overview-label">Missing</span>
      <strong class="recruiter-overview-value">${missingCount}</strong>
    </div>
  `;
}

function isDisplayableKeywordTag(keyword) {
  const term = String(keyword?.term || keyword || '')
    .trim()
    .toLowerCase();
  if (!term) return false;
  if (term.length === 1) return false;
  if (term === 'go' || term === 'r') return false;
  return true;
}

function renderSearchVisibilitySummary(keywordData = {}) {
  const matched = (keywordData.matched || []).filter(isDisplayableKeywordTag).slice(0, 14);
  const missing = (keywordData.missing || []).filter(isDisplayableKeywordTag).slice(0, 14);
  if (!matched.length && !missing.length) return '';

  return `
    <section class="search-visibility-card">
      <div class="search-visibility-header">
        <div>
          <div class="search-visibility-kicker">Keyword Signals</div>
          <h3 class="search-visibility-title">Search Visibility Analysis</h3>
          <p class="search-visibility-body">These terms are helping or hurting recruiter search coverage for this role.</p>
        </div>
        <div class="search-visibility-stats">
          <div class="search-visibility-stat is-matched">
            <span class="search-visibility-stat-label">Matched</span>
            <strong>${matched.length}</strong>
          </div>
          <div class="search-visibility-stat is-missing">
            <span class="search-visibility-stat-label">Missing</span>
            <strong>${missing.length}</strong>
          </div>
        </div>
      </div>
      <div class="search-visibility-grid">
        <section class="search-visibility-section">
          <h4 class="search-visibility-section-title">Helping search visibility</h4>
          <div class="keyword-list">
            ${
              matched.length
                ? matched
                    .map(keyword => `<span class="keyword-tag matched">${esc(keyword.term || keyword)}</span>`)
                    .join('')
                : '<span class="search-visibility-empty">No strong keyword matches yet.</span>'
            }
          </div>
        </section>
        <section class="search-visibility-section">
          <h4 class="search-visibility-section-title">Still missing from the resume</h4>
          <div class="keyword-list">
            ${
              missing.length
                ? missing
                    .map(keyword => `<span class="keyword-tag missing">${esc(keyword.term || keyword)}</span>`)
                    .join('')
                : '<span class="search-visibility-empty">No major missing keywords in this snapshot.</span>'
            }
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderRecruiterVisibility(xrayData = {}, keywordData = {}) {
  const fieldAccuracy = xrayData.fieldAccuracy || {};
  const extractedFields = xrayData.extractedFields || {};
  const recruiterOverview = el('agent-recruiter-overview');
  const recruiterRows = el('agent-recruiter-rows');
  const searchVisibility = el('agent-search-visibility');

  if (recruiterOverview) {
    recruiterOverview.innerHTML = safeHtml(buildRecruiterOverview(fieldAccuracy, extractedFields));
  }

  if (recruiterRows) {
    recruiterRows.innerHTML = safeHtml(buildRecruiterRows(fieldAccuracy, extractedFields));
  }

  if (searchVisibility) {
    searchVisibility.innerHTML = safeHtml(renderSearchVisibilitySummary(keywordData));
  }
}

// ── AI Bullet Fixer ────────────────────────────────────────────
async function fixBullet(btn) {
  const idx = btn.dataset.index;
  const bullet = btn.dataset.bullet;
  const resultDiv = el('fix-result-' + idx);

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loading"></span> Scanning with ATS engine...';

  try {
    const res = await fetch('/api/fix-bullet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bulletText: bullet, jobDescription: lastJobInput }),
    });
    const data = await res.json();

    if (data.error) {
      const needsCredits = data.buyCredits || data.signup;
      btn.textContent = data.signup ? 'Sign up to fix →' : needsCredits ? 'Buy Credits →' : 'Retry';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
      if (needsCredits) {
        btn.dataset.action = 'navigate';
        btn.dataset.path = data.signup ? '/signup' : '/pricing';
      }
      btn.disabled = false;
      showToast(data.error, 'error');
      return;
    }
    // Update credit balance in navbar if returned
    if (data.creditBalance !== undefined && currentUser) {
      currentUser.user.creditBalance = data.creditBalance;
      updateNavCredits(data.creditBalance);
    }

    resultDiv.innerHTML = safeHtml(`
      <div class="diff-after">
        <div class="diff-label diff-label-after">Refined Rewrite (CAR Formula)</div>
        <p id="fix-text-${idx}">${esc(data.rewritten)}</p>
      </div>
      <div class="diff-meta">
        <span class="badge badge-purple">${esc(data.targetKeyword || 'General')}</span>
        <span class="badge badge-blue">${esc(data.method || 'CAR Formula')}</span>
        <span class="badge badge-green">Clarity Pass</span>
        <button class="btn-copy" data-copy-text="${esc(data.rewritten)}">${uiIcon('copy', { size: 14, stroke: 2 })} Copy</button>
      </div>
      ${
        data.needsMetric && data.metricPrompt
          ? `
      <div class="context-metric-prompt" style="margin-top:0.75rem">
        <div class="metric-prompt-header">
          <span class="metric-prompt-icon">${uiIcon('chart', { size: 14, stroke: 2 })}</span>
          <span class="metric-prompt-label">The AI needs a real number here</span>
        </div>
        <p class="metric-prompt-question">${esc(data.metricPrompt)}</p>
        <div class="metric-prompt-input-row">
          <input type="text" class="metric-prompt-input" placeholder="e.g., reduced by 40%" id="fix-metric-${idx}" />
          <button class="btn btn-sm btn-primary" data-action="apply-fix-metric" data-fix-index="${esc(String(idx))}">Apply</button>
        </div>
      </div>`
          : ''
      }
      ${
        data.contextAudit && data.contextAudit.warnings && data.contextAudit.warnings.length
          ? `
      <div class="context-warnings" style="margin-top:0.5rem">
        ${data.contextAudit.warnings.map(w => `<div class="context-warning-item"><span class="context-warning-icon">${uiIcon('warning', { size: 14, stroke: 2 })}</span> ${esc(w)}</div>`).join('')}
      </div>`
          : ''
      }
    `);
    // Update the parent diff-card border
    const card = el('fix-card-' + idx);
    if (card) card.classList.add('bullet-complete');

    // Update the "Fix with AI" button to show completed state
    const actionsDiv = btn.closest('.diff-actions');
    if (actionsDiv) {
      actionsDiv.innerHTML = safeHtml(`
        <div class="diff-badges">
          <span class="badge badge-green">Refined</span>
        </div>
      `);
    }
  } catch {
    btn.textContent = 'Retry';
    btn.disabled = false;
  }
}

// ── Metric Application (Context Humanizer) ──────────────────────────
function applyFixMetric(fixIndex) {
  const input = el('fix-metric-' + fixIndex);
  if (!input || !input.value.trim()) return;
  const metric = input.value.trim();
  const textEl = el('fix-text-' + fixIndex);
  if (!textEl) return;

  let text = textEl.textContent;
  text = text.replace(/\[X%?\]|\[\$X[KMB]?\]|\[N[^\]]*\]|\[\d+[%xX]?\]/gi, metric);
  if (text === textEl.textContent) {
    text = text.replace(/\.$/, '') + ` (${metric}).`;
  }
  textEl.textContent = text;
  input.closest('.context-metric-prompt').remove();
  showToast('Metric applied!', 'success');
}

// ── UI Utilities ──────────────────────────────────────────────
function setupMobileMenu() {
  const menuBtn = el('mobile-menu-btn');
  const sheet = el('bottom-sheet');
  const backdrop = el('bottom-sheet-backdrop');
  if (!menuBtn || !sheet || !backdrop) return;
  if (menuBtn._bound) return; // Prevent double-binding
  menuBtn._bound = true;

  // Store last focused element for focus restoration
  let lastFocusedElement = null;
  let focusTrapHandler = null;

  function openSheet() {
    lastFocusedElement = document.activeElement;
    sheet.classList.add('open');
    backdrop.classList.add('open');
    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-label', 'Close menu');
    document.body.style.overflow = 'hidden';
    sheet.setAttribute('aria-hidden', 'false');

    // Activate focus trap
    setupFocusTrap(sheet);

    // Focus first focusable element
    const firstFocusable = getFocusableElements(sheet)[0];
    if (firstFocusable) firstFocusable.focus();
  }
  function closeSheet() {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-label', 'Open menu');
    document.body.style.overflow = '';
    sheet.setAttribute('aria-hidden', 'true');
    // Reset any swipe transform
    sheet.style.transform = '';
    sheet.style.transition = '';

    // Remove focus trap
    if (focusTrapHandler) {
      sheet.removeEventListener('keydown', focusTrapHandler);
      focusTrapHandler = null;
    }

    // Restore focus
    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  // Focus trap implementation for accessibility
  function getFocusableElements(container) {
    return Array.from(
      container.querySelectorAll(
        'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.disabled && el.offsetParent !== null);
  }

  function setupFocusTrap(container) {
    focusTrapHandler = e => {
      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements(container);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    container.addEventListener('keydown', focusTrapHandler);
  }

  // Menu button opens/closes bottom sheet
  menuBtn.addEventListener('click', () => {
    if (sheet.classList.contains('open')) closeSheet();
    else openSheet();
  });

  // Close on backdrop click
  backdrop.addEventListener('click', closeSheet);

  // Close on Escape key — store so it's only added once (menuBtn._bound prevents re-entry)
  function onSheetEscape(e) {
    if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
  }
  document.addEventListener('keydown', onSheetEscape);

  // Close on link/button click inside sheet
  sheet.addEventListener('click', e => {
    if (e.target.closest('a') || e.target.closest('button')) closeSheet();
  });

  // Wire up bottom sheet logout
  const sheetLogout = el('bottom-sheet-logout');
  if (sheetLogout) {
    sheetLogout.addEventListener('click', async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      closeSheet();
      // Call the real logout handler directly rather than simulating a .click()
      // on the desktop button, which on mobile produced a ghost-click race that
      // could land on an underlying dashboard link after the sheet animated out.
      if (typeof window.__rxLogout === 'function') {
        await window.__rxLogout(ev);
      } else {
        const desktopLogout = el('nav-logout');
        if (desktopLogout) desktopLogout.click();
      }
    });
  }

  // ── Swipe-to-dismiss ──
  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  sheet.addEventListener(
    'touchstart',
    e => {
      // Only initiate swipe from the handle area (top 40px of sheet)
      const rect = sheet.getBoundingClientRect();
      const touchY = e.touches[0].clientY;
      if (touchY - rect.top > 48) return;

      isDragging = true;
      startY = e.touches[0].clientY;
      currentY = startY;
      sheet.style.transition = 'none'; // Disable transition for real-time tracking
    },
    { passive: true }
  );

  sheet.addEventListener(
    'touchmove',
    e => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const deltaY = Math.max(0, currentY - startY); // Only allow downward swipe
      sheet.style.transform = `translateY(${deltaY}px)`;
    },
    { passive: true }
  );

  sheet.addEventListener(
    'touchend',
    () => {
      if (!isDragging) return;
      isDragging = false;
      const deltaY = currentY - startY;

      // Restore transition for snap-back or close animation
      sheet.style.transition = '';

      if (deltaY > 100) {
        // Swiped far enough — close
        closeSheet();
      } else {
        // Snap back
        sheet.style.transform = 'translateY(0)';
      }
    },
    { passive: true }
  );
}

function showToast(message, type = 'info', options = {}) {
  if (uiHelpers) {
    uiHelpers.showToast(message, type, options);
  }
}

function dismissToast(toast) {
  return uiHelpers?.dismissToast(toast);
}

function copyToClipboard(text, btn) {
  return uiHelpers?.copyToClipboard(text, btn);
}

function esc(str) {
  if (uiHelpers) return uiHelpers.esc(str);
  if (typeof str !== 'string') str = String(str || '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Decode HTML entities stored in DB (e.g. &amp; → &, &amp;amp; → &amp;)
// Uses a detached textarea so no XSS risk — value is text, not innerHTML
function decodeHtml(str) {
  if (uiHelpers) return uiHelpers.decodeHtml(str);
  if (!str || typeof str !== 'string') return str || '';
  const t = document.createElement('textarea');
  t.innerHTML = str;
  return t.value;
}

// DOMPurify safety net for innerHTML — belt-and-braces defense.
// Use safeHtml() for any innerHTML that includes dynamic content.
function safeHtml(html) {
  if (uiHelpers) return uiHelpers.safeHtml(html);
  if (typeof window.DOMPurify !== 'undefined')
    return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return html; // Fallback if DOMPurify fails to load — esc() already escapes
}

function truncate(str, len) {
  if (uiHelpers) return uiHelpers.truncate(str, len);
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

function currentScanTokenQuery() {
  const token =
    currentScan?.access_token || currentScan?.accessToken || getPersistedCurrentScanToken() || null;
  return token ? `&token=${encodeURIComponent(token)}` : '';
}

function getActiveScanId() {
  const candidates = [
    el('agent-download-bar')?.dataset?.scanId,
    currentScan?.id,
    currentScan?.scanId,
    localStorage.getItem('resumeXray_currentScanId'),
  ];
  for (const candidate of candidates) {
    const parsed = Number.parseInt(String(candidate || '').trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function scanHasTargetJob(scan = currentScan, jobContext = getJobContext(scan)) {
  const context = jobContext || getJobContext(scan);
  return !!(
    context?.jobUrl ||
    context?.jdText ||
    context?.jobTitle ||
    (scan?.job_description && String(scan.job_description).trim())
  );
}

function persistCurrentScanToken(token) {
  if (token) localStorage.setItem('resumeXray_currentScanToken', token);
  else localStorage.removeItem('resumeXray_currentScanToken');
}

function getPersistedCurrentScanToken() {
  return localStorage.getItem('resumeXray_currentScanToken') || '';
}

function buildScanApiUrl(scanId) {
  const tokenQuery = currentScanTokenQuery().replace(/^&/, '');
  return tokenQuery ? `/api/scan/${scanId}?${tokenQuery}` : `/api/scan/${scanId}`;
}

async function startCheckout(packId) {
  if (!currentUser) return navigateTo('/signup');
  try {
    const res = await fetch('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else showToast(data.error || 'Checkout error', 'error');
  } catch {
    showToast('Checkout failed. Please try again.', 'error');
  }
}

// ── Utility: Count-up animation ──────────────────────────────
function animateCountUp(element, target, duration = 1200) {
  const start = performance.now();
  const from = 0;
  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out curve
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (target - from) * eased);
    element.textContent = current + '%';
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ── Utility: Format file size ────────────────────────────────
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Cover Letter Rendering & Actions ─────────────────────────
let currentCoverLetterText = '';

function coverLetterPreviewUrl(scanId) {
  return `/api/agent/cover-letter-preview/${esc(scanId)}?t=${Date.now()}${currentPreviewProfileQuery()}${currentScanTokenQuery()}`;
}

function attachPreviewIframeListeners(wrapper, iframe) {
  const skeleton = wrapper?.querySelector('.document-preview-skeleton');
  if (!iframe) return;

  iframe.addEventListener('load', () => {
    if (skeleton) skeleton.style.display = 'none';
    iframe.style.opacity = '1';
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        iframe.style.height = '920px';
        return;
      }
      const contentHeight = Math.max(
        doc.documentElement?.scrollHeight || 0,
        doc.body?.scrollHeight || 0
      );
      iframe.style.height = `${Math.max(contentHeight, 920)}px`;
    } catch {
      iframe.style.height = '920px';
    }
  });

  iframe.addEventListener('error', () => {
    if (wrapper) {
      wrapper.innerHTML = safeHtml(`
        <div class="document-preview-error">
          <div style="font-size:3rem;margin-bottom:1rem;opacity:0.5">&#9993;&#65039;</div>
          <h4 style="color:var(--text-main);margin-bottom:0.5rem">Cover letter preview unavailable</h4>
          <p class="body-sm">The preview could not be loaded for this variant. Try another style or refresh the scan.</p>
        </div>
      `);
    }
  });
}

function reloadCoverLetterPreview(scanId) {
  const clContainer = el('cover-letter-content');
  const actions = el('cover-letter-actions');
  if (!clContainer) return;

  clContainer.innerHTML = safeHtml(`
    <div class="document-iframe-wrapper">
      <div class="document-preview-skeleton">
        <div class="loader"></div>
        <p class="body-sm text-muted" style="margin-top:var(--sp-3)">Loading cover letter preview...</p>
      </div>
      <iframe class="preview-iframe" src="${coverLetterPreviewUrl(scanId)}" title="Cover letter preview"></iframe>
    </div>
  `);

  const wrapper = clContainer.querySelector('.document-iframe-wrapper');
  const iframe = wrapper?.querySelector('.preview-iframe');
  attachPreviewIframeListeners(wrapper, iframe);
  if (actions) actions.style.display = 'flex';
}

function renderCoverLetter(text) {
  currentCoverLetterText = text;
  const clContainer = el('cover-letter-content');
  const actions = el('cover-letter-actions');
  if (!clContainer) return;

  const scanId = getActiveScanId();
  const canGenerateCoverLetter = scanHasTargetJob(currentScan);

  if (!scanId || !canGenerateCoverLetter) {
    clContainer.innerHTML = safeHtml(
      '<div class="document-text-preview"><div class="cover-letter-placeholder"><div style="margin-bottom:1rem;opacity:0.4"><svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,4 12,13 2,4"/></svg></div><h4>No cover letter yet</h4><p class="body-sm text-muted" style="margin-top:0.5rem;margin-bottom:1.5rem">Cover letters are generated when you include a target job link or paste the job description with your scan.</p><div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-action="navigate" data-path="/scan">Scan with Target Job</button></div></div></div>'
    );
    if (actions) actions.style.display = 'none';
    return;
  }

  if (text && text.trim().length > 0) {
    clContainer.innerHTML = safeHtml(
      `<div id="cover-letter-stream" class="agent-stream-text document-text-preview">${esc(text)}</div>`
    );
    if (actions) actions.style.display = 'flex';
    return;
  }
  reloadCoverLetterPreview(scanId);
}

// Cover letter action handlers
document.addEventListener('click', e => {
  if (
    e.target.id === 'download-cover-letter-pdf' ||
    e.target.closest('#download-cover-letter-pdf')
  ) {
    downloadCoverLetter('pdf');
  }

  // Download cover letter as DOCX
  if (
    e.target.id === 'download-cover-letter-docx' ||
    e.target.closest('#download-cover-letter-docx')
  ) {
    downloadCoverLetter('docx');
  }
});

async function downloadCoverLetter(format) {
  // Gate: guests must log in to download
  if (!currentUser) {
    showToast('Create a free account to download your cover letter.', 'info', { duration: 5000 });
    setTimeout(() => navigateTo('/signup'), 1400);
    return;
  }

  const scanId = getActiveScanId();
  if (!scanId) {
    showToast('No scan data available. Please run a new scan first.', 'warning');
    return;
  }

  try {
    const query = new URLSearchParams({
      format,
      type: 'cover_letter',
      template: getSelectedTemplate(),
    });
    const density = getSelectedDensity();
    if (density) query.set('density', density);
    const res = await fetch(`/api/agent/download/${scanId}?${query.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.upgrade) {
        showToast('No credits remaining — upgrade to download.', 'warning', { duration: 4000 });
        setTimeout(() => navigateTo('/pricing'), 1200);
      } else {
        showToast(data.error || 'Download failed', 'error');
      }
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cover-letter.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    showToast(`Cover letter downloaded as ${format.toUpperCase()}!`, 'success');

    // Refresh credit balance
    if (currentUser) await fetchUser();
  } catch {
    showToast('Download failed — please check your connection and try again.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COOKIE CONSENT MANAGEMENT PLATFORM (CMP)
// ═══════════════════════════════════════════════════════════════════════════════
// Legal Framework Compliance:
//   ✔ EU GDPR Art.7 — Granular, freely given, informed, unambiguous consent
//   ✔ EU ePrivacy Directive Art.5(3) — Prior blocking of non-essential cookies
//   ✔ UK PECR / DUAA 2025 — Analytics exemption acknowledged, consent requested anyway
//   ✔ US CCPA/CPRA §1798.120 — "Do Not Sell/Share" + Global Privacy Control (GPC)
//   ✔ EDPB Guidelines — No dark patterns, equal-prominence buttons, no pre-ticked boxes
//
// Architecture:
//   - All non-essential scripts are BLOCKED by default (no cookies before consent)
//   - Consent stored in localStorage (not a cookie — avoids circular dependency)
//   - Versioned consent records with timestamps for GDPR Art.7(1) audit proof
//   - Three categories: Essential (locked ON), Analytics (OFF), Marketing (OFF)
//   - GPC signal (navigator.globalPrivacyControl) auto-rejects sale/sharing
// ═══════════════════════════════════════════════════════════════════════════════

(function initCookieConsentCMP() {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'rx_cookie_consent';
  const CONSENT_LOG_KEY = 'rx_consent_log';
  const CONSENT_VERSION = '2.0'; // Bump when banner text/categories change
  const BANNER_DELAY_MS = 1200; // Delay before first banner display (UX)

  // ── DOM References ─────────────────────────────────────────────────────────
  const banner = document.getElementById('cookie-consent-banner');
  const acceptBtn = document.getElementById('cookie-accept');
  const rejectBtn = document.getElementById('cookie-reject');
  const customizeBtn = document.getElementById('cookie-customize');
  const savePrefsBtn = document.getElementById('cookie-save-prefs');
  const prefPanel = document.getElementById('cookie-preferences');
  const settingsLink = document.getElementById('footer-cookie-settings');
  const ccpaLink = document.getElementById('cookie-banner-ccpa-link');
  const toggleAnalytics = document.getElementById('cookie-toggle-analytics');
  const toggleMarketing = document.getElementById('cookie-toggle-marketing');

  if (!banner) return;

  // ── Default Consent State ──────────────────────────────────────────────────
  // GDPR: All non-essential categories default to OFF (no pre-ticked boxes)
  const DEFAULT_CONSENT = {
    version: CONSENT_VERSION,
    essential: true, // Always ON — cannot be disabled
    analytics: false, // OFF by default
    marketing: false, // OFF by default
    timestamp: null,
    method: null, // 'accept_all', 'reject_all', 'custom', 'gpc_signal'
  };

  // ── Consent Storage (localStorage-based) ───────────────────────────────────

  function getStoredConsent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Invalidate if consent version changed (re-prompt required by GDPR)
      if (parsed.version !== CONSENT_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveConsent(consent) {
    consent.timestamp = new Date().toISOString();
    consent.version = CONSENT_VERSION;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
      appendConsentLog(consent);
    } catch {}
  }

  /**
   * GDPR Art.7(1) Audit Trail — Append timestamped consent record to log.
   * Stores up to 50 historical entries for audit proof.
   */
  function appendConsentLog(consent) {
    try {
      const log = JSON.parse(localStorage.getItem(CONSENT_LOG_KEY) || '[]');
      log.push({
        timestamp: consent.timestamp,
        version: consent.version,
        method: consent.method,
        analytics: consent.analytics,
        marketing: consent.marketing,
        gpcDetected: !!navigator.globalPrivacyControl,
        userAgent: navigator.userAgent.substring(0, 100),
      });
      // Keep last 50 entries only (storage efficiency)
      if (log.length > 50) log.splice(0, log.length - 50);
      localStorage.setItem(CONSENT_LOG_KEY, JSON.stringify(log));
    } catch {}
  }

  // ── Cookie Activation/Deactivation ─────────────────────────────────────────

  /**
   * Apply consent decisions to the page.
   * Sets data attributes on <html> that CSS/JS can use to gate scripts.
   */
  function applyConsent(consent) {
    const html = document.documentElement;
    html.dataset.cookieConsent = 'configured';
    html.dataset.consentAnalytics = consent.analytics ? 'granted' : 'denied';
    html.dataset.consentMarketing = consent.marketing ? 'granted' : 'denied';

    if (consent.analytics) {
      enableAnalytics();
    } else {
      disableAnalytics();
    }

    if (consent.marketing) {
      enableMarketing();
    } else {
      disableMarketing();
    }
  }

  /**
   * Enable analytics tracking (only after explicit consent).
   * PLACEHOLDER — Activate when you add Google Analytics, Plausible, etc.
   */
  function enableAnalytics() {
    // Example: Google Analytics 4
    // if (!window.gtag) {
    //   const script = document.createElement('script');
    //   script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX';
    //   script.async = true;
    //   document.head.appendChild(script);
    //   window.dataLayer = window.dataLayer || [];
    //   window.gtag = function() { dataLayer.push(arguments); };
    //   gtag('js', new Date());
    //   gtag('config', 'G-XXXXXXXXXX', { anonymize_ip: true });
    // }
  }

  function disableAnalytics() {
    // Remove analytics cookies if they exist
    // document.cookie.split(';').forEach(c => {
    //   if (c.trim().startsWith('_ga') || c.trim().startsWith('_gid')) {
    //     document.cookie = c.split('=')[0].trim() + '=;expires=Thu, 01 Jan 1970;path=/;domain=.' + location.hostname;
    //   }
    // });
  }

  function enableMarketing() {
    // Placeholder for future marketing/ad pixels
  }

  function disableMarketing() {
    // Remove marketing cookies if they exist
  }

  // ── UI Helpers ─────────────────────────────────────────────────────────────

  function showBanner() {
    banner.style.display = 'block';
    if (prefPanel) prefPanel.style.display = 'none'; // Reset to Layer 1
  }

  function hideBanner() {
    banner.style.display = 'none';
  }

  function showPreferences() {
    if (prefPanel) {
      prefPanel.style.display = 'block';
      prefPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function syncToggles(consent) {
    if (toggleAnalytics) toggleAnalytics.checked = consent.analytics;
    if (toggleMarketing) toggleMarketing.checked = consent.marketing;
  }

  // ── Consent Actions ────────────────────────────────────────────────────────

  function acceptAll() {
    const consent = { ...DEFAULT_CONSENT, analytics: true, marketing: true, method: 'accept_all' };
    saveConsent(consent);
    applyConsent(consent);
    hideBanner();
  }

  function rejectAll() {
    const consent = {
      ...DEFAULT_CONSENT,
      analytics: false,
      marketing: false,
      method: 'reject_all',
    };
    saveConsent(consent);
    applyConsent(consent);
    hideBanner();
  }

  function saveCustomPreferences() {
    const consent = {
      ...DEFAULT_CONSENT,
      analytics: toggleAnalytics ? toggleAnalytics.checked : false,
      marketing: toggleMarketing ? toggleMarketing.checked : false,
      method: 'custom',
    };
    saveConsent(consent);
    applyConsent(consent);
    hideBanner();
  }

  // ── CCPA/CPRA: "Do Not Sell/Share" ─────────────────────────────────────────

  function handleDoNotSell() {
    // CCPA §1798.120: Opt out of sale/sharing of personal information
    const consent = {
      ...DEFAULT_CONSENT,
      analytics: false,
      marketing: false,
      method: 'ccpa_opt_out',
    };
    saveConsent(consent);
    applyConsent(consent);
    hideBanner();
    // Confirmation required by CCPA 2026 regulations
    if (typeof showToast === 'function') {
      showToast(
        'Your opt-out request has been honored. No data will be sold or shared.',
        'success'
      );
    }
  }

  // ── GPC (Global Privacy Control) Detection ─────────────────────────────────
  // CCPA/CPRA requires honoring browser GPC signal as valid opt-out.
  // GDPR still requires showing the banner for informed consent.
  // Solution: Pre-set non-essential toggles to OFF when GPC detected,
  // but STILL show the banner so the user makes an informed choice.

  const gpcDetected = navigator.globalPrivacyControl === true;

  // ── Initialization ─────────────────────────────────────────────────────────

  const existing = getStoredConsent();

  if (existing) {
    // Valid consent exists — apply it silently (no banner)
    applyConsent(existing);
    syncToggles(existing);
  } else {
    // No consent — ALWAYS show banner (GDPR requirement)
    // If GPC is active, toggles are already OFF by default (matches GPC intent)
    setTimeout(showBanner, BANNER_DELAY_MS);
  }

  // ── Event Listeners ────────────────────────────────────────────────────────

  if (acceptBtn) acceptBtn.addEventListener('click', acceptAll);
  if (rejectBtn) rejectBtn.addEventListener('click', rejectAll);

  if (customizeBtn) {
    customizeBtn.addEventListener('click', () => {
      // Load current preferences into toggles
      const current = getStoredConsent() || DEFAULT_CONSENT;
      syncToggles(current);
      showPreferences();
    });
  }

  if (savePrefsBtn) savePrefsBtn.addEventListener('click', saveCustomPreferences);

  // CCPA "Do Not Sell/Share" link
  if (ccpaLink) {
    ccpaLink.addEventListener('click', e => {
      e.preventDefault();
      handleDoNotSell();
    });
  }

  // Footer "Cookie Settings" link — re-opens the banner with current state
  if (settingsLink) {
    settingsLink.addEventListener('click', e => {
      e.preventDefault();
      const current = getStoredConsent() || DEFAULT_CONSENT;
      syncToggles(current);
      showBanner();
      banner.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }
})();
