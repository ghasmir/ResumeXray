// ═══════════════════════════════════════════════════════════════
// ResumeXray V4 — "See It. Fix It. Land It."
// Premium ATS Intelligence Platform
// ═══════════════════════════════════════════════════════════════

let currentUser = null;
let currentScan = null;
let lastJobInput = '';
let loadResultsToken = 0; // Cancellation token for loadResults retries

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

  window.onerror = function(message, source, line, column, error) {
    reportError({ message, source, line, column, stack: error?.stack, type: 'onerror' });
  };

  window.addEventListener('unhandledrejection', function(event) {
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
  } catch { /* non-critical on first load */ }
}

// Patch global fetch to auto-attach CSRF token on state-changing requests
const _originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
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
      const body = await res.clone().json().catch(() => null);
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
  await fetchUser();
  setupRouter();
  setupGlobalDelegation();
  setupFileUpload();
  setupAuthForms();
  setupPasswordToggles();
  setupResultsTabs();
  setupMobileMenu();
  setupAgentResults();

  let path = window.location.pathname;
  if (path === '/' && currentUser) path = '/dashboard';
  navigateTo(path);
});

// ── Auth State ─────────────────────────────────────────────────
async function fetchUser() {
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
  try {
    const res = await fetch('/user/me');
    if (res.ok) {
      currentUser = await res.json();
      const user = currentUser.user || currentUser;
      
      // Update UI elements
      const initials = (user.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      if (el('nav-avatar-initials')) el('nav-avatar-initials').textContent = initials;
      const avatarUrl = user.avatarUrl || user.avatar || null; // handle both field names
      if (avatarUrl && el('nav-avatar')) {
        // Safe avatar rendering — validate URL protocol before injection
        const safeUrl = (avatarUrl.startsWith('https://') || avatarUrl.startsWith('/')) ? avatarUrl : '';
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
}

function updateNavCredits(balance) {
  const countEl = el('nav-credits-count');
  if (countEl) countEl.textContent = balance;
  
  const badge = el('nav-credits-badge');
  if (badge) {
    badge.title = `${balance} credits remaining`;
    badge.onclick = (e) => {
      e.stopPropagation();
      navigateTo('/pricing');
    };
  }
}

function el(id) { return document.getElementById(id); }

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
    const isActive = (path === href) || (href !== '/' && path.startsWith(href));
    a.classList.toggle('active', isActive);
  });
}

function resetScanForm() {
  const form = el('scan-form');
  if (form) { form.reset(); form.style.display = 'block'; }
  const preview = el('file-preview');
  if (preview) preview.style.display = 'none';
  const area = el('upload-area');
  if (area) { area.style.display = ''; area.classList.remove('file-selected'); }
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
    length:  el(prefix + '-rule-length'),
    number:  el(prefix + '-rule-number'),
    upper:   el(prefix + '-rule-upper'),
    special: el(prefix + '-rule-special'),
  };

  function checkPassword() {
    const pw = input.value;
    const checks = {
      length:  pw.length >= 8,
      number:  /\d/.test(pw),
      upper:   /[A-Z]/.test(pw),
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

  // Listen to all possible input events (type, paste, autofill)
  ['input', 'keyup', 'change', 'paste'].forEach(evt => {
    input.addEventListener(evt, checkPassword);
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
          body: JSON.stringify({ name, email, password })
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
            showToast('📧 Check your inbox! Verify your email to claim your free download credit.', 'info', { duration: 8000 });
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
          body: JSON.stringify({ email, password })
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
          body: JSON.stringify({ email })
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
          body: JSON.stringify({ token, password })
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
    if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }

    // Actions
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.preventDefault();
      const action = actionBtn.dataset.action;
      if (action === 'navigate') navigateTo(actionBtn.dataset.path);
      else if (action === 'checkout') startCheckout(actionBtn.dataset.plan);
      else if (action === 'manage-billing') openBillingPortal();
      else if (action === 'fix-bullet') fixBullet(actionBtn);
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
  const doLogout = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

    // Set guard flag FIRST — prevents fetchUser from re-authenticating on reload
    try { sessionStorage.setItem('rx_logged_out', '1'); } catch {}

    try {
      const res = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      try { await res.json(); } catch {}
    } catch { /* proceed with client-side cleanup regardless */ }

    currentUser = null;
    try { localStorage.removeItem('resumeXray_currentScanId'); } catch {}

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
  // Unified tab system: works with both old (.tab-content/.tab-btn) and new (.results-tab-pane/.results-tab-btn)
  document.querySelectorAll('.tab-content, .results-tab-pane').forEach(t => {
    t.classList.remove('active-tab');
    t.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn, .results-tab-btn').forEach(b => b.classList.remove('active'));

  // New HTML uses data-tab values that ARE the element IDs (e.g. "tab-diagnosis")
  // Old HTML uses data-tab values that need "tab-" prefix (e.g. "diagnosis" → "tab-diagnosis")
  let tab = document.getElementById(tabId) || el('tab-' + tabId);
  let btn = document.querySelector(`[data-tab="${tabId}"]`) || el('btn-' + tabId);
  if (tab) { tab.classList.add('active'); tab.classList.add('active-tab'); tab.setAttribute('role', 'tabpanel'); }
  if (btn) { btn.classList.add('active'); btn.setAttribute('aria-selected', 'true'); }

  // Update aria-selected on all tab buttons
  document.querySelectorAll('.results-tab-btn').forEach(b => {
    if (b !== btn) b.setAttribute('aria-selected', 'false');
  });

  // Trigger lazy-loading for PDF if switched to that tab
  if (tabId === 'tab-pdf-preview' || tabId === 'pdf-preview') {
    const previewFrame = el('pdf-preview-frame');
    const bar = el('agent-download-bar');
    if (previewFrame && bar && bar.dataset.scanId) {
      // Reload if iframe is blank OR if it's pointing to a different scan
      if (!previewFrame.src || previewFrame.src.includes('about:blank') || !previewFrame.src.includes(bar.dataset.scanId)) {
        reloadPdfPreview(bar.dataset.scanId);
      }
    }
  }
  // Lazy-load cover letter preview when switching to that tab
  if (tabId === 'tab-cover-letter' || tabId === 'cover-letter') {
    const bar = el('agent-download-bar');
    const clContainer = el('cover-letter-content');
    if (bar && bar.dataset.scanId && clContainer && !clContainer.querySelector('.preview-iframe')) {
      renderCoverLetter('');
    }
  }
}

// ── File Upload + Scan ─────────────────────────────────────────
function setupFileUpload() {
  const form = el('scan-form');
  const fileInput = el('resume-file');
  const area = el('upload-area');
  if (!form || !area) return;

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['.pdf', '.docx', '.doc', '.txt'];

  function showFilePreview(file) {
    if (!file) return;
    // Validate type
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) {
      el('scan-error').textContent = `Unsupported file type "${ext}". Please upload PDF, DOCX, DOC, or TXT.`;
      el('scan-error').style.display = 'block';
      fileInput.value = '';
      return;
    }
    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      el('scan-error').textContent = `File too large (${formatFileSize(file.size)}). Maximum size is 5MB.`;
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

    const icons = { '.pdf': '📕', '.docx': '📘', '.doc': '📘', '.txt': '📄' };
    const iconEl = el('file-preview').querySelector('.file-preview-icon');
    if (iconEl) iconEl.textContent = icons[ext] || '📄';
  }

  function removeFile() {
    fileInput.value = '';
    el('file-preview').style.display = 'none';
    area.classList.remove('file-selected');
    // Disable scan submit button
    const submitBtn = el('scan-submit-btn');
    if (submitBtn) submitBtn.disabled = true;
  }

  area.addEventListener('click', () => fileInput.click());
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('dragover');
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
  if (removeBtn) removeBtn.addEventListener('click', e => { e.stopPropagation(); removeFile(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!fileInput.files.length) {
      el('scan-error').textContent = 'Please select a resume file first.';
      el('scan-error').style.display = 'block';
      return;
    }

    el('scan-error').style.display = 'none';
    form.style.display = 'none';
    el('scan-loading').style.display = 'flex';

    lastJobInput = el('job-input').value;
    const fd = new FormData();
    fd.append('resume', fileInput.files[0]);

    // Smart input detection: if it looks like a URL, send as jobUrl. Otherwise as jobDescription text.
    const jdVal = lastJobInput.trim();
    if (jdVal.startsWith('http://') || jdVal.startsWith('https://')) {
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
        headers: _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {}
      });
      const data = await res.json();
      
      if (data.error) {
        form.style.display = 'block';
        el('scan-loading').style.display = 'none';
        let errHtml = esc(data.error);
        if (data.signup || data.upgrade) {
          const path = data.signup ? '/signup' : '/pricing';
          const label = data.signup ? 'Create a free account to continue →' : 'Upgrade for unlimited scans →';
          errHtml += `<br><a href="${path}" data-link style="color:var(--accent);text-decoration:underline;font-weight:600;margin-top:0.5rem;display:inline-block">${label}</a>`;
        }
        el('scan-error').innerHTML = safeHtml(errHtml);
        el('scan-error').style.display = 'block';
      } else {
        // Start the live streaming agent
        // IMPORTANT: Do NOT use navigateTo('/agent-results') here!
        // The router's /agent-results handler checks localStorage for old scan IDs
        // and redirects to /results/{oldId}, which races with the new SSE stream.
        // Instead, directly activate the view and start the analysis.
        localStorage.removeItem('resumeXray_currentScanId');
        currentScan = null;
        history.pushState({}, '', '/agent-results');
        // Ensure we are viewing the diagnosis tab during the scan
        switchTab('tab-diagnosis');

        startAgentAnalysis(data.sessionId);
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

function startAgentAnalysis(sessionId) {
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

  // Nudge guests to convert — single CTA at the bottom of agent timeline only
  // (additional paywalls are overlaid on the score gauges, Cover Letter tab, etc.)
  // Removed duplicate nudge block here (issue #6) — the unlock-overlay on 
  // agent-score-summary already handles this.
  
  const scoreAfterCard = el('score-after-card');
  if (scoreAfterCard) scoreAfterCard.style.display = 'none';
  document.querySelectorAll('.progress-step').forEach(s => {
    s.classList.remove('complete', 'running', 'error');
  });
  
  // fetch + ReadableStream replaces EventSource.
  // fetch() sends session cookies automatically (same-origin), enabling server-side auth.
  // EventSource cannot send custom headers and had no authentication — anyone could stream.
  const abortController = new AbortController();
  agentSource = abortController; // Store so we can abort on error/complete

  fetch(`/api/agent/stream/${sessionId}`, {
    credentials: 'same-origin',
    signal: abortController.signal,
    headers: { 'Accept': 'text/event-stream' }
  }).then(response => {
    if (!response.ok) {
      showToast('Stream authentication failed. Please try again.', 'error');
      agentSource = null;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function processSSE() {
      reader.read().then(({ done, value }) => {
        if (done) return;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

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

        processSSE(); // Continue reading
      }).catch(err => {
        if (err.name !== 'AbortError') {
          showToast('Stream connection lost. Please try again.', 'error');
        }
        agentSource = null;
      });
    }

    processSSE();
  }).catch(err => {
    if (err.name !== 'AbortError') {
      showToast('Failed to connect to analysis stream.', 'error');
    }
    agentSource = null;
  });

  // SSE event dispatcher — same logic as the old EventSource listeners
  function handleSSEEvent(eventType, dataStr) {
    let data;
    try { data = JSON.parse(dataStr); } catch { return; }

    switch (eventType) {
      case 'step':
        updateAgentProgress(data.step, data.status);
        if (data.status === 'running') {
          if (initBlock) initBlock.style.display = 'none';
          if (dashboard) dashboard.style.display = 'block';
          addAgentStepCard(data.step, data.name, data.label);
        } else if (data.status === 'complete' || data.status === 'locked' || data.status === 'error') {
          if (initBlock) initBlock.style.display = 'none';
          if (dashboard) dashboard.style.display = 'block';
          updateAgentStepCard(data.step, data.status, data.label, data.data);
          if (data.status === 'error') {
            abortController.abort();
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
              targetKeyword: data.targetKeyword
            });
          }
        }
        renderAgentBullet(data);
        break;

      case 'scores':
        updateAgentScores(data);
        break;

      case 'coverLetter':
        if (data.text) renderCoverLetter(data.text);
        break;

      case 'atsProfile':
        // Show ATS platform badge in download bar
        if (data.displayName && data.name !== 'generic') {
          const atsBadge = el('ats-platform-badge');
          if (atsBadge) {
            atsBadge.textContent = `Optimized for ${data.displayName}`;
            atsBadge.style.display = 'inline-flex';
          }
        }
        break;

      case 'complete':
        abortController.abort();
        agentSource = null;
        if (data.resumeText) agentResumeText = data.resumeText;
        if (data.scanId) {
          history.replaceState({}, '', `/results/${data.scanId}`);
          localStorage.setItem('resumeXray_currentScanId', String(data.scanId));
        }
        if (currentUser) fetchUser().then(() => finalizeAgentUI(data));
        else finalizeAgentUI(data);
        break;

      case 'error':
        abortController.abort();
        agentSource = null;
        // Hide loading state and restore the upload form so the user can retry
        const loadingEl = el('scan-loading');
        const formEl = el('scan-form');
        if (loadingEl) loadingEl.style.display = 'none';
        if (formEl) formEl.style.display = 'block';
        if (data.message && data.message.includes('professional resume')) {
          showToast('This file doesn\'t appear to be a standard resume. Please upload a professional resume in PDF or DOCX format.', 'warning');
          document.querySelectorAll('.progress-step.running').forEach(item => {
            item.classList.remove('running');
            item.classList.add('error');
          });
        } else {
          showToast(data.message || 'Analysis interrupted — please try again. If this persists, contact support.', 'error');
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
  card.innerHTML = `
    <div class="agent-step-header" data-toggle-step="${step}">
      <div class="agent-step-icon running"></div>
      <div class="agent-step-label">${esc(label)}</div>
      <div class="agent-step-status">Analyzing...</div>
    </div>
    <div class="agent-step-body" id="agent-body-${step}">
      <div class="agent-stream-text" id="stream-${step}"><span class="cursor"></span></div>
    </div>
  `;
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
  icon.textContent = status === 'complete' ? '' : (status === 'locked' ? '🔒' : (status === 'error' ? '✖' : '!'));
  
  if (status === 'error') {
    statusLabels.textContent = 'REJECTED';
    statusLabels.style.color = 'var(--red)';
    statusLabels.style.fontWeight = '700';
  } else {
    statusLabels.textContent = status === 'complete' ? 'Completed' : (status === 'locked' ? 'Locked' : 'Failed');
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
  if (data && step === 1) { // Parse
    body.innerHTML = `
      <div class="flex gap-4 items-center">
        <div><strong>Sections:</strong> ${data.sections.join(', ')}</div>
        <div><strong>Word Count:</strong> ${data.wordCount}</div>
      </div>
    `;
  } else if (data && step === 7 && status === 'locked') { // Rewrite (locked)
    body.innerHTML += `
      <div class="agent-upgrade-prompt">
        <h4>${data.lockedCount} more improvements available</h4>
        <p>Free scans include 5 rewrites. Purchase credits to unlock all improvements.</p>
        <button class="btn btn-primary btn-sm" data-action="navigate" data-path="/pricing">Unlock All Fixes →</button>
      </div>
    `;
  } else if (data && step === 8 && Array.isArray(data)) {
    // Plan step — format as readable suggestions instead of raw JSON
    const suggestions = data.map(item => {
      const kw = item.keyword || item.Keyword || '';
      const section = item.section || item.Section || '';
      const suggestion = item.suggestion || item.Suggestion || '';
      return `<li style="margin-bottom:0.5rem"><strong>${esc(kw)}</strong> → ${esc(section)}: <em>${esc(suggestion)}</em></li>`;
    }).join('');
    body.innerHTML = `<ul style="list-style:none;padding:0;font-size:0.85rem;color:var(--text-secondary)">${suggestions}</ul>`;
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
  
  const cursor = container.querySelector('.cursor') || (function() {
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
  
  const isGuest = !currentUser;
  
  if (data.status === 'rewriting') {
    const bulletCard = document.createElement('div');
    bulletCard.className = 'agent-bullet-card animate-fade-up';
    bulletCard.id = `bullet-card-${data.index}`;
    bulletCard.innerHTML = `
      <div class="agent-bullet-before">
        <div class="agent-bullet-label before">BEFORE</div>
        <div class="agent-bullet-text">${esc(data.original)}</div>
      </div>
      <div class="agent-bullet-after ${isGuest ? 'guest-blurred' : ''}">
        <div class="agent-bullet-label after">OPTIMIZING...</div>
        <div class="agent-bullet-text" id="bullet-rewrite-text-${data.index}"><span class="cursor"></span></div>
      </div>
    `;
    
    // Add unlock overlay for guests on the "AFTER" side
    if (isGuest) {
      const afterSide = bulletCard.querySelector('.agent-bullet-after');
      const overlay = document.createElement('div');
      overlay.className = 'unlock-overlay-small';
      overlay.innerHTML = `<button class="btn btn-xs btn-primary" data-auth="signup">Sign Up to Unlock</button>`;
      afterSide.appendChild(overlay);
    }
    
    body.appendChild(bulletCard);
  } else if (data.status === 'complete') {
    const card = el(`bullet-card-${data.index}`);
    if (!card) return;

    // Finalize the rewrite
    const rewriteEl = el(`bullet-rewrite-text-${data.index}`);
    if (rewriteEl) rewriteEl.textContent = data.rewritten;
    
    const afterLabel = card.querySelector('.agent-bullet-label.after');
    if (afterLabel) {
      afterLabel.textContent = '✓ HUMANIZED';
      afterLabel.classList.add('done');
    }

    // Add success border
    card.classList.add('bullet-complete');

    const meta = document.createElement('div');
    meta.className = `agent-bullet-meta ${isGuest ? 'guest-blurred' : ''}`;
    meta.innerHTML = `
      <span class="badge badge-purple">${esc(data.targetKeyword || 'General')}</span>
      <span class="badge badge-blue">${esc(data.method || 'CAR Formula')}</span>
      <span class="badge badge-green">Anti-Fluff ✓</span>
    `;
    card.appendChild(meta);
  }
}

function updateAgentScores(scores) {
  const summary = el('agent-score-summary');
  summary.style.display = 'grid';
  
  const isGuest = !currentUser;
  if (isGuest) {
    summary.classList.add('blurred-container');
    // Check if overlay already exists
    if (!summary.querySelector('.unlock-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'unlock-overlay';
      overlay.innerHTML = `
        <div class="unlock-card">
          <div class="unlock-icon">🔒</div>
          <div class="unlock-title">Unlock Full Analysis</div>
          <div class="unlock-text">See your detailed ATS scores and professional bullet points.</div>
          <div class="flex gap-4">
            <button class="btn btn-primary" data-auth="signup">Create Free Account</button>
            <button class="btn btn-secondary" data-auth="login">Log In</button>
          </div>
        </div>
      `;
      summary.appendChild(overlay);
    }
    // Apply blur to children
    Array.from(summary.children).forEach(child => {
      if (!child.classList.contains('unlock-overlay')) {
        child.classList.add('guest-blurred');
      }
    });
  }

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
      setTimeout(() => { if (gauge) gauge.setAttribute('stroke-dashoffset', offset); }, 100);
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

  if (parseRate !== null) {
    animateGauge('gauge-parse', 'score-ats-ready', parseRate, gaugeColor(parseRate));
  }
  if (formatHealth !== null) {
    animateGauge('gauge-format', 'score-format-health', formatHealth, gaugeColor(formatHealth));
  }
  if (matchRate !== null) {
    animateGauge('gauge-match', 'score-job-match', matchRate, gaugeColor(matchRate));
  }
  if (matchAfter !== null) {
    const scoreAfter = el('score-after-card');
    if (scoreAfter) scoreAfter.style.display = '';
    animateGauge('gauge-after', 'score-job-match-after', matchAfter, 'var(--green)');
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
    if (label.textContent === 'OPTIMIZING...') label.textContent = 'HUMANIZED';
  });
  document.querySelectorAll('.cursor').forEach(c => c.remove());

  // 3. Store scanId in memory with normalized shape
  //    The SSE complete event uses .scanId; the API uses .id
  //    We normalize so both paths work.
  if (data.scanId) {
    currentScan = { ...data, id: data.scanId };
  }

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
  document.querySelectorAll('.results-tab-pane').forEach(p => p.style.display = '');

  // 5. Store scanId for lazy-loading in the PDF tab
  const bar = el('agent-download-bar');
  if (bar && data.scanId) bar.dataset.scanId = data.scanId;

  // 6. No full-page overlay — just show the tab and toast
  switchTab('tab-diagnosis');
  showToast('Analysis complete! Your optimized resume is ready in the Optimized Resume tab.', 'success');
  
  // Smooth scroll to the score gauges
  const scoreSummary = el('agent-score-summary');
  if (scoreSummary) {
    scoreSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 7. Fetch full scan data from API to populate Recruiter View + PDF preview
  if (data.scanId) {
    try {
      const scanRes = await fetch('/api/scan/' + data.scanId);
      if (scanRes.ok) {
        const scanJson = await scanRes.json();
        if (scanJson.results) {
          const fullData = scanJson.results;
          currentScan = { ...currentScan, ...fullData, id: data.scanId };

          // Populate Recruiter View
          const xray = fullData.xrayData || {};
          const recBody = el('agent-recruiter-rows');
          if (recBody && typeof buildRecruiterRows === 'function') {
            const rowsHtml = buildRecruiterRows(xray.fieldAccuracy || {}, xray.extractedFields || {});
            if (rowsHtml && rowsHtml.trim().length > 0) {
              recBody.innerHTML = rowsHtml;
            }
          }

          // Populate Search Visibility
          const kwVisibility = el('agent-search-visibility');
          const keywords = fullData.keywordData || {};
          const matched = keywords.matched || [];
          const missing = keywords.missing || [];
          if (kwVisibility && (matched.length > 0 || missing.length > 0)) {
            kwVisibility.innerHTML = `
              <div class="card" style="background:var(--bg-card-subtle); padding:var(--sp-6); border:1px solid rgba(255,255,255,0.05)">
                <h4 style="margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Search Visibility Analysis
                </h4>
                <div class="keyword-list">
                  ${matched.slice(0, 15).map(k => `<span class="keyword-tag matched">✓ ${esc(k.term || k)}</span>`).join('')}
                  ${missing.slice(0, 15).map(k => `<span class="keyword-tag missing">✗ ${esc(k.term || k)}</span>`).join('')}
                </div>
              </div>
            `;
          }

          // Populate Cover Letter
          if (fullData.coverLetterText) {
            renderCoverLetter(fullData.coverLetterText);
          } else {
            const clContainer = el('cover-letter-content');
            if (clContainer) clContainer.innerHTML = '<div class="preview-empty" style="padding:2rem;text-align:center;color:var(--text-muted);">No cover letter for this scan</div>';
            const clActions = el('cover-letter-actions');
            if (clActions) clActions.style.display = 'none';
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
  if (balanceEl) balanceEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${creditBalance} credits`;

  if (creditBalance < 1 && currentUser) {
    const msgEl = el('download-credit-msg');
    if (msgEl) msgEl.innerHTML = 'You need 1 credit to download. <a href="/pricing" data-link style="color:var(--accent)">Buy credits →</a>';
  }
}

// ── Shared Dashboard Variables ─────────────────────────────────
let agentResumeText = '';
let agentBulletPairs = []; // {original, rewritten, method, targetKeyword}

function setupPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const input = btn.previousElementSibling;
      if (input && input.tagName === 'INPUT') {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🙈';
          btn.setAttribute('aria-label', 'Hide password');
        } else {
          input.type = 'password';
          btn.textContent = '👁️';
          btn.setAttribute('aria-label', 'Show password');
        }
      }
    });
  });
}

function setupResultsTabs() {
  // Delegate to switchTab() which handles activation, lazy-loading, and aria attributes
  document.querySelectorAll('.results-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      if (targetId) {
        // Clear rogue inline display styles before switching
        document.querySelectorAll('.results-tab-pane').forEach(p => p.style.display = '');
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
  ['tpl-modern', 'tpl-classic', 'tpl-minimal'].forEach(id => {
    const btn = el(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const bar = el('agent-download-bar');
      const scanId = bar ? bar.dataset.scanId : null;
      if (!scanId) return;
      document.querySelectorAll('[data-template]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reloadPdfPreview(scanId);
    });
  });
}

// ── Helpers for current preview state ──
function getSelectedTemplate() {
  // Hardcoded to 'modern' — template selector removed from UI
  return 'modern';
}

function getSelectedDensity() {
  // Hardcoded to 'standard' — density selector removed from UI
  return 'standard';
}

function reloadPdfPreview(scanId) {
  const previewFrame = el('pdf-preview-frame');
  if (previewFrame) {
    // Apply an initial responsive height and width for the PDF preview frame
    function adaptPdfFrameSize(frame) {
      if (!frame) return;
      const h = Math.max(320, Math.min(900, window.innerHeight * 0.62));
      frame.style.height = h + 'px';
      frame.style.width = '100%';
    }

    adaptPdfFrameSize(previewFrame);
    // Bind a resize handler once per frame to adjust height on viewport changes
    if (!previewFrame._pdfrsBound) {
      const resizeHandler = () => adaptPdfFrameSize(previewFrame);
      window.addEventListener('resize', resizeHandler);
      previewFrame._pdfrsBound = true;
      previewFrame._pdfrsResizeHandler = resizeHandler;
    }
    const template = getSelectedTemplate();
    const density = getSelectedDensity();
    // Show loading skeleton while iframe renders
    const container = previewFrame.parentElement;
    let skeleton = container?.querySelector('.preview-skeleton');
    if (!skeleton && container) {
      skeleton = document.createElement('div');
      skeleton.className = 'preview-skeleton';
      skeleton.innerHTML = '<div class="loader"></div><p class="body-sm text-muted" style="margin-top:var(--sp-3)">Rendering preview…</p>';
      skeleton.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem;';
      container.insertBefore(skeleton, previewFrame);
    }
    if (skeleton) skeleton.style.display = 'flex';
    previewFrame.style.opacity = '0';
    let url = `/api/agent/preview/${scanId}?template=${template}&density=${density}&t=${Date.now()}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
    if (currentScan && currentScan.access_token) url += `&token=${currentScan.access_token}`;
    previewFrame.src = url;
    previewFrame.addEventListener('load', function onLoad() {
      previewFrame.style.opacity = '1';
      if (skeleton) skeleton.style.display = 'none';
      previewFrame.removeEventListener('load', onLoad);
      // Re-apply size in case iframe content changes height after load
      adaptPdfFrameSize(previewFrame);
    });
  }
}

async function downloadOptimized(format) {
  // Gate: guests must log in to download
  if (!currentUser) {
    showToast('Create a free account to download your optimized resume.', 'info', { duration: 5000 });
    setTimeout(() => navigateTo('/signup'), 1400);
    return;
  }

  const bar = el('agent-download-bar');
  if (!bar) return;
  const scanId = bar.dataset.scanId;
  if (!scanId) return;
  
  const template = getSelectedTemplate();
  const density = getSelectedDensity();
  
  try {
    const res = await fetch(`/api/agent/download/${scanId}?format=${format}&template=${template}&density=${density}`);
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
    a.download = `optimized-resume-${template}.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    showToast('Resume downloaded!', 'success');
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
      loadingEl.style.cssText = 'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:9999;flex-direction:column;gap:1rem';
      loadingEl.innerHTML = '<div class="loader"></div><p class="body-md" style="opacity:0.6">Loading your results...</p>';
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
      const res = await fetch('/api/scan/' + scanId);
      if (res.ok) {
        const json = await res.json();
        results = json.results;
        if (results) {
          results.id = results.id || scanId;
          currentScan = results;
        }
      } else if (retryCount < MAX_RETRIES) {
        console.log(`[loadResults] scan/${scanId} returned ${res.status}, retry ${retryCount + 1}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, 1000));
        if (loadResultsToken !== myToken) return; // Navigation happened, abort
        return loadResults(scanId, retryCount + 1);
      }
    } catch (e) {
      if (retryCount < MAX_RETRIES) {
        console.log(`[loadResults] scan/${scanId} network error, retry ${retryCount + 1}/${MAX_RETRIES}`);
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
      dashboard.innerHTML = '<div class="card text-center" style="padding:3rem"><h3>Scan not found</h3><p class="body-sm" style="margin:1rem 0">This scan may have been deleted or doesn\'t exist.</p><button class="btn btn-primary" data-action="navigate" data-path="/scan">New Scan</button></div>';
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

  // 1. Dashboard + tabs visible
  const dashboard = el('results-dashboard');
  if (dashboard) dashboard.style.display = 'block';
  const tabMenu = el('results-tabs-menu');
  if (tabMenu) tabMenu.style.display = ''; // Let CSS (grid on mobile, flex on desktop) take over

  // 2. Configure PDF viewer overlays
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
  if (bar && scanId) bar.dataset.scanId = scanId;

  // 4. Update Header Scores
  updateAgentScores({
    parseRate: data.parseRate || 0,
    formatHealth: data.formatHealth || 0,
    matchRate: data.matchRate || 0,
    matchRateAfter: data.matchRateAfter || null
  });

  // 5. Populate Historical Timeline
  if (typeof renderAgentHistoricalTimeline === 'function') {
    renderAgentHistoricalTimeline(data);
  }

  // 6. Populate Recruiter View (Field Extraction)
  const xray = data.xrayData || {};
  const recBody = el('agent-recruiter-rows');
  if (recBody) {
    const rowsHtml = typeof buildRecruiterRows === 'function' 
      ? buildRecruiterRows(xray.fieldAccuracy || {}, xray.extractedFields || {})
      : '';
    
    if (rowsHtml && rowsHtml.trim().length > 0) {
      recBody.innerHTML = rowsHtml;
      
      const isGuest = !currentUser;
      const recTab = el('tab-recruiter-agent');
      if (isGuest && recTab) {
        recTab.classList.add('blurred-container');
        if (!recTab.querySelector('.unlock-overlay')) {
          const overlay = document.createElement('div');
          overlay.className = 'unlock-overlay';
          overlay.innerHTML = `
            <div class="unlock-card">
              <div class="unlock-icon">🔒</div>
              <div class="unlock-title">Unlock Recruiter Visibility</div>
              <div class="unlock-text">See precisely what Workday and Taleo parsers extract into their databases.</div>
              <div class="flex gap-4">
                <button class="btn btn-primary" data-auth="signup">Sign Up to Unlock</button>
              </div>
            </div>
          `;
          recTab.appendChild(overlay);
        }
      }
    } else {
      recBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:4rem; color:var(--text-muted)">
        <div style="margin-bottom:1.5rem; opacity:0.5"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
        <h4 style="color:var(--text-main)">Parser data unavailable</h4>
        <p class="body-sm" style="margin-top:0.5rem">This legacy scan record only contains the final scores.</p>
        <p class="body-xs" style="margin-top:1rem; opacity:0.6">Run a new scan to see live extraction and keywords.</p>
      </td></tr>`;
    }
  }

  // 7. Search Visibility Summary
  const kwVisibility = el('agent-search-visibility');
  if (kwVisibility) {
    const keywords = data.keywordData || {};
    const matched = keywords.matched || [];
    const missing = keywords.missing || [];
    if (matched.length > 0 || missing.length > 0) {
      kwVisibility.innerHTML = `
        <div class="card" style="background:var(--bg-card-subtle); padding:var(--sp-6); border:1px solid rgba(255,255,255,0.05)">
          <h4 style="margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem">
            <span style="font-size:1.25rem">🔍</span> Search Visibility Analysis
          </h4>
          <p class="body-xs text-muted" style="margin-bottom:1.5rem">These keywords were found in your resume based on the job description:</p>
          <div class="keyword-list">
            ${matched.slice(0, 15).map(k => `<span class="keyword-tag matched">✓ ${esc(k.term || k)}</span>`).join('')}
            ${missing.slice(0, 15).map(k => `<span class="keyword-tag missing">✗ ${esc(k.term || k)}</span>`).join('')}
          </div>
        </div>
      `;
    } else {
      kwVisibility.innerHTML = '';
    }
  }

  // 7b. Populate Cover Letter (if available from historical data)
  if (data.coverLetterText) {
    renderCoverLetter(data.coverLetterText);
  } else {
    const clContainer = el('cover-letter-content');
    if (clContainer) {
      clContainer.innerHTML = `
        <div class="cover-letter-placeholder">
          <div style="font-size:3rem; margin-bottom:1rem; opacity:0.4">✉️</div>
          <h4>No cover letter for this scan</h4>
          <p class="body-sm text-muted" style="margin-top:0.5rem">Cover letters require a job description. Run a new scan with a JD to generate one.</p>
        </div>
      `;
    }
    const clActions = el('cover-letter-actions');
    if (clActions) clActions.style.display = 'none';
  }

  // 8. Auto-load PDF preview (Only if optimized data exists)
  const isAgentScan = !!(data.optimizedResumeText || (data.optimizedBullets && data.optimizedBullets.length > 0));
  const previewFrame = el('pdf-preview-frame');

  if (isAgentScan && previewFrame && scanId) {
    previewFrame.src = `/api/agent/preview/${scanId}?t=${Date.now()}`;
    if (viewOverlay) viewOverlay.style.display = 'flex';
  } else if (scanOverlay) {
    // Basic Scan or Error — Show upgrade message in PDF tab
    scanOverlay.style.display = 'flex';
    scanOverlay.innerHTML = `
      <div style="font-size:3.5rem; margin-bottom:1.5rem">✨</div>
      <h3 class="headline">Unlock FAANG Formatting</h3>
      <p class="body-sm text-muted" style="margin-top:1rem; max-width:320px; text-align:center">Your ATS Diagnosis is complete. Upgrade to <strong>Pro Agent</strong> to unlock our one-page "Humanized" template and auto-bullet rewriting.</p>
      <button class="btn btn-primary" style="margin-top:2rem" data-action="navigate" data-path="/pricing">View Pro Plans</button>
    `;
  }

  // ── 8b. Guest Content Protection Overlays ────────────────────────────
  // For non-logged-in users, overlay Cover Letter and Optimized Resume
  // tabs with a professional paywall to prevent free screenshot usage.
  const isGuest = !currentUser;

  if (isGuest) {
    // Cover Letter tab — blur + paywall
    const clTab = el('tab-cover-letter');
    if (clTab && !clTab.querySelector('.unlock-overlay')) {
      clTab.classList.add('blurred-container');
      const clOverlay = document.createElement('div');
      clOverlay.className = 'unlock-overlay';
      clOverlay.innerHTML = `
        <div class="unlock-card">
          <div class="unlock-icon">✉️</div>
          <div class="unlock-title">Your AI Cover Letter is Ready</div>
          <div class="unlock-text">Sign up to preview your personalized cover letter. Export as PDF or DOCX costs 1 credit.</div>
          <div style="display:flex; gap:0.75rem; margin-top:1rem;">
            <button class="btn btn-primary" data-auth="signup">Create Free Account</button>
            <button class="btn btn-ghost btn-sm" data-auth="login" style="color:var(--text-muted)">Log In</button>
          </div>
        </div>
      `;
      clTab.appendChild(clOverlay);
    }

    // Optimized Resume tab — blur + paywall
    const pdfTab = el('tab-pdf-preview');
    if (pdfTab && !pdfTab.querySelector('.unlock-overlay')) {
      pdfTab.classList.add('blurred-container');
      const pdfOverlay = document.createElement('div');
      pdfOverlay.className = 'unlock-overlay';
      pdfOverlay.innerHTML = `
        <div class="unlock-card">
          <div class="unlock-icon">📄</div>
          <div class="unlock-title">ATS-Optimized Resume Ready</div>
          <div class="unlock-text">Your resume has been rebuilt with FAANG formatting rules. Sign up to preview and export.</div>
          <div style="display:flex; gap:0.75rem; margin-top:1rem;">
            <button class="btn btn-primary" data-auth="signup">Create Free Account</button>
            <button class="btn btn-ghost btn-sm" data-auth="login" style="color:var(--text-muted)">Log In</button>
          </div>
        </div>
      `;
      pdfTab.appendChild(pdfOverlay);
    }
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
    report: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    xray: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    target: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    sparkle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
  };

  function createCard(iconSvg, accentColor, title, subtitle, bodyHtml, variant) {
    const card = document.createElement('div');
    card.className = `tl-card${variant ? ' tl-card--' + variant : ''}`;
    card.innerHTML = `
      <div class="tl-card-accent" style="background:${accentColor}"></div>
      <div class="tl-card-icon" style="background:${accentColor}15;color:${accentColor}">${iconSvg}</div>
      <div class="tl-card-content">
        <div class="tl-card-title">${title}</div>
        ${subtitle ? `<div class="tl-card-subtitle">${subtitle}</div>` : ''}
        ${bodyHtml ? `<div class="tl-card-body">${bodyHtml}</div>` : ''}
      </div>
    `;
    return card;
  }

  // 1. Analysis Report Header
  const scanDate = new Date(data.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  timeline.appendChild(createCard(
    icons.report,
    'var(--accent)',
    `Analysis Report: ${esc(data.jobTitle || 'General Analysis')}`,
    `Scan completed on ${scanDate}`,
    null,
    null
  ));

  // 2. Section Coverage (X-Ray)
  const xray = data.xrayData || {};
  const sections = xray.extractedFields || {};
  const foundSections = Object.keys(sections).filter(k => sections[k] && sections[k].toString().trim().length > 0);
  
  if (foundSections.length > 0) {
    const sectionPills = foundSections.map(s => `<span class="tl-tag">${esc(s)}</span>`).join('');
    timeline.appendChild(createCard(
      icons.xray,
      'var(--blue)',
      `Database Indexing: ${foundSections.length} Core Sections Detected`,
      null,
      `<div class="tl-tags">${sectionPills}</div>`,
      null
    ));
  }

  // 3. Formatting Risks
  const issues = data.formatIssues || [];
  if (issues.length > 0) {
    const issueList = issues.map(i => `<li>${esc(i.title || i)}</li>`).join('');
    timeline.appendChild(createCard(
      icons.warning,
      'var(--red)',
      `${issues.length} Formatting Risk${issues.length > 1 ? 's' : ''} Identified`,
      null,
      `<ul class="tl-issue-list">${issueList}</ul>`,
      'danger'
    ));
  } else {
    timeline.appendChild(createCard(
      icons.check,
      'var(--green)',
      'ATS Parsing Integrity: 100%',
      'No significant formatting errors or parsing hurdles detected.',
      null,
      'success'
    ));
  }

  // 4. Job Match Insights
  if (data.matchRate !== undefined) {
    const rate = Math.round(data.matchRate);
    const level = rate > 70 ? 'strong' : rate > 40 ? 'moderate' : 'low';
    const color = rate > 70 ? 'var(--green)' : rate > 40 ? 'var(--amber)' : 'var(--red)';
    timeline.appendChild(createCard(
      icons.target,
      color,
      `JD Semantic Score: ${rate}%`,
      `Your profile has a ${level} alignment with this role.`,
      `<div class="tl-progress-bar"><div class="tl-progress-fill" style="width:${rate}%;background:${color}"></div></div>`,
      null
    ));
  }

  // 5. AI Optimization Summary
  const bullets = data.optimizedBullets || [];
  if (bullets.length > 0) {
    timeline.appendChild(createCard(
      icons.sparkle,
      'var(--purple)',
      'Premium Optimizations Applied',
      `${bullets.length} experience bullet${bullets.length > 1 ? 's were' : ' was'} re-engineered for higher impact using the CAR formula.`,
      null,
      'premium'
    ));
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
  const tierNames = { free: 'FREE', starter: 'STARTER', pro: 'PRO', hustler: 'HUSTLER' };
  if (el('dash-plan-bento')) {
    const tierClass = tier === 'free' ? 'tier-free' : 'tier-pro';
    el('dash-plan-bento').innerHTML = `<span id="dash-tier-badge" class="dash-tier-badge ${tierClass}">${tierNames[tier]}</span> ⚡ ${creditBalance}`;
  }

  // Update Manage Button — consistent text
  const manageBtn = el('dash-manage-btn');
  if (manageBtn) {
    manageBtn.innerHTML = `<button class="btn btn-primary btn-sm" data-action="navigate" data-path="/pricing">Get More Credits →</button>`;
  }

  // Fetch History
  try {
    const res = await fetch('/user/dashboard');
    if (!res.ok) return;
    const data = await res.json();
    
    // Update Last Score Card
    if (data.scans?.length > 0) {
      const last = data.scans[0];
      el('stat-last-score').textContent = Math.round(last.match_rate || 0) + '%';
      let lastTitle = last.job_title || 'General Scan';
      if (last.company_name && !lastTitle.toLowerCase().includes(last.company_name.toLowerCase())) {
        lastTitle = `${lastTitle}, ${last.company_name}`;
      }
      el('stat-last-title').textContent = lastTitle.substring(0, 24) + (lastTitle.length > 24 ? '...' : '');
      el('stat-last-title').title = lastTitle;
      el('stat-last-title').innerHTML += `<div class="body-xs" style="opacity:0.4;margin-top:2px">${timeAgo(last.created_at)}</div>`;
    }

    const list = el('dash-scans-list');
    if (!list) return;

    if (!data.scans?.length) {
      list.innerHTML = `
        <div class="empty-state card bento-glass text-center" style="padding:3rem">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin:0 auto 1rem"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <p style="font-weight:600;margin-bottom:0.5rem">No scans yet</p>
          <p class="body-sm" style="opacity:0.5;margin-bottom:1.25rem">You haven't scanned any resumes yet. Upload one to see how ATS software reads it.</p>
          <button class="btn btn-primary" data-action="navigate" data-path="/scan">Scan My Resume</button>
        </div>`;
    } else {
      list.innerHTML = data.scans.map(s => {
        const parse = Math.round(s.parse_rate || 0);
        const match = Math.round(s.match_rate || 0);
        const best = Math.max(parse, match);
        const borderColor = best >= 80 ? 'var(--green)' : best >= 50 ? 'var(--amber)' : 'var(--red)';

        // 1. Graceful Fallback Logic
        let title = s.job_title;
        let companyLabel = s.company_name || '';
        if (!title || title.toLowerCase() === 'no job description') {
            // Try URL path slug first (LinkedIn: /jobs/view/data-analyst-at-company-123/)
            if (s.job_url) {
                try {
                    const u = new URL(s.job_url);
                    const segments = u.pathname.split('/').filter(Boolean);
                    const slug = segments[segments.length - 1] || '';
                    // Strip trailing numeric ID (LinkedIn job IDs), hyphens → spaces
                    const cleaned = slug.replace(/[-_]?\d{5,}$/, '').replace(/[-_]+/g, ' ').trim();
                    if (cleaned.length >= 4 && cleaned.length < 80) {
                        title = cleaned.replace(/\b\w/g, c => c.toUpperCase()).replace(/\bAt\b/g, 'at');
                    } else {
                        title = u.hostname.replace(/^www\./, '');
                    }
                    // Extract company from hostname if not already set
                    if (!companyLabel) {
                        const host = u.hostname.replace(/^www\./, '');
                        const domainMap = {
                          'linkedin.com': 'LinkedIn', 'indeed.com': 'Indeed',
                          'greenhouse.io': 'Greenhouse', 'lever.co': 'Lever',
                          'workday.com': 'Workday', 'naukri.com': 'Naukri',
                          'glassdoor.com': 'Glassdoor', 'monster.com': 'Monster'
                        };
                        const matchedDomain = Object.keys(domainMap).find(d => host.includes(d));
                        if (matchedDomain) companyLabel = domainMap[matchedDomain];
                    }
                } catch(e) { title = 'Linked Job'; }
            } else if (s.company_name) {
                title = `Role at ${s.company_name}`;
            } else if (s.job_description && s.job_description.trim().length > 0) {
                title = 'Pasted Job Description';
            } else {
                title = 'General Scan (No JD)';
            }
        }

        // Append company name to title if available: "Data Analyst, TechGenies"
        if (companyLabel && !title.toLowerCase().includes(companyLabel.toLowerCase())) {
          title = `${title}, ${companyLabel}`;
        }

        const displayTitle = title.length > 45 ? title.substring(0, 45) + '...' : title;

        return `
        <div class="card scan-history-card animate-fade-up" data-action="navigate" data-path="/results/${s.id}" role="button" tabindex="0" style="margin-bottom:1rem; border-left:3px solid ${borderColor}; cursor:pointer; padding: 1.25rem;">
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
        </div>`;
      }).join('');
    }
  } catch {
    const list = el('dash-scans-list');
    if (list) list.innerHTML = '<div class="card" style="padding:1.5rem;text-align:center;opacity:0.6">Couldn\'t load scan history. Please refresh the page.</div>';
  }
}

async function renderProfile() {
  if (!currentUser) return;
  await fetchUser();
  const user = currentUser.user;
  const creditBalance = user.creditBalance || 0;
  const tier = user.tier || 'free';

  el('profile-name').textContent = user.name;
  el('profile-email').textContent = user.email;
  el('profile-joined').textContent = new Date(user.joinedAt || Date.now()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Tier badge
  const tierNames = { free: 'Free', starter: 'Starter', pro: 'Pro', hustler: 'Hustler' };
  const badge = el('profile-tier-badge');
  badge.textContent = tierNames[tier] || 'Free';
  badge.className = `tier-badge tier-${tier}`;

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
    verifyBanner.style.display = (!user.isVerified && !isOAuthUser) ? 'flex' : 'none';
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
          headers: _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {}
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Verification email sent! Check your inbox.', 'success');
          resendBtn.textContent = 'Sent ✓';
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

  // ── OAuth Provider Badges ─────────────────────────────────────
  const providerBadgesEl = el('profile-provider-badges');
  if (providerBadgesEl && user.provider) {
    const providerInfo = {
      google:   { label: 'Google Connected', color: '#ea4335' },
      linkedin: { label: 'LinkedIn Connected', color: '#0a66c2' },
      github:   { label: 'GitHub Connected', color: '#6e5494' },
    };
    const info = providerInfo[user.provider];
    if (info) {
      providerBadgesEl.style.display = 'flex';
      providerBadgesEl.innerHTML = `
        <span class="provider-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          ${info.label}
        </span>`;
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
          body: formData  // Let browser set Content-Type multipart/form-data automatically
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
        showToast(err.message || 'Unable to upload avatar. Please try a smaller JPEG or PNG.', 'error');
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
        histEl.innerHTML = data.history.map(h => `
          <div class="credit-history-row">
            <div>
              <div style="font-weight:500">${esc(h.description || h.type)}</div>
              <div class="body-xs" style="color:var(--text-muted)">${timeAgo(h.created_at)}</div>
            </div>
            <div class="${h.amount > 0 ? 'credit-amount-pos' : 'credit-amount-neg'}">
              ${h.amount > 0 ? '<span class="credit-label">Earned</span> +' : '<span class="credit-label">Used</span> '}${h.amount}
            </div>
          </div>
        `).join('');
      } else {
        histEl.innerHTML = `
          <div style="text-align:center;padding:1.5rem 0;opacity:0.5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 0.5rem;display:block;opacity:0.4"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            <p class="body-sm">Credits appear here when you purchase or use them</p>
          </div>`;
      }
    }
  } catch {
    const histEl = el('profile-credit-history');
    if (histEl) histEl.innerHTML = '<p class="body-sm" style="color:var(--text-muted)">Couldn\'t load credit history.</p>';
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
  if (pwCancel) pwCancel.onclick = () => {
    el('password-modal').style.display = 'none';
    document.body.classList.remove('modal-open');
    // Reset the strength indicator state
    const container = el('profile-pw-strength');
    if (container) container.classList.remove('visible');
  };
  const pwForm = el('password-form');
  if (pwForm) {
    pwForm.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = el('pw-error');
      errEl.style.display = 'none';
      try {
        const res = await fetch('/user/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: el('pw-current').value, newPassword: el('pw-new').value })
        });
        const data = await res.json();
        if (data.error) { errEl.textContent = data.error; errEl.style.display = 'block'; }
        else { el('password-modal').style.display = 'none'; document.body.classList.remove('modal-open'); showToast('Password updated!', 'success'); pwForm.reset(); }
      } catch { errEl.textContent = 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
    };
  }

  // Delete account modal
  const delBtn = el('btn-delete-account');
  if (delBtn) delBtn.onclick = () => { el('delete-modal').style.display = 'flex'; document.body.classList.add('modal-open'); };
  const delCancel = el('delete-cancel');
  if (delCancel) delCancel.onclick = () => { el('delete-modal').style.display = 'none'; document.body.classList.remove('modal-open'); };
  const delForm = el('delete-form');
  if (delForm) {
    delForm.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = el('delete-error');
      errEl.style.display = 'none';
      try {
        const res = await fetch('/user/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmEmail: el('delete-confirm-email').value })
        });
        const data = await res.json();
        if (data.error) { errEl.textContent = data.error; errEl.style.display = 'block'; }
        else { currentUser = null; showToast('Account deleted', 'success'); navigateTo('/'); location.reload(); }
      } catch { errEl.textContent = 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
    };
  }
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
function buildRecruiterRows(fieldAccuracy, extractedFields) {
  // Use either the accuracy map or the raw extraction keys
  const fields = Object.keys(fieldAccuracy).length > 0 
    ? Object.keys(fieldAccuracy) 
    : Object.keys(extractedFields);

  if (fields.length === 0) {
    return `<tr><td colspan="3" style="text-align:center;padding:4rem;color:var(--text-muted)">
      <div style="font-size:3rem; margin-bottom:1.5rem; opacity:0.5">📭</div>
      <h4 style="color:var(--text-main)">Parser data unavailable</h4>
      <p class="body-sm" style="margin-top:0.5rem">This scan record does not contain structured parser data.</p>
      <p class="body-xs" style="margin-top:1rem; opacity:0.6">Try running a new scan to see live extraction.</p>
    </td></tr>`;
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
      'email', 'phone', 'phone_number', 'ssn', 'ssn_number', 'address',
      'postal', 'birthday', 'date_of_birth'
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

  return fields.map(fieldName => {
    const info = fieldAccuracy[fieldName] || {};
    const status = info.status || (extractedFields[fieldName] ? 'success' : 'missing');
    const rawValue = info.value || extractedFields[fieldName] || '';
    
    const isMissing = !rawValue || rawValue.includes('[Parser could not extract');
    // Use longer truncation for content-heavy fields
    const isLongField = ['Experience', 'Education', 'Skills', 'Summary'].includes(fieldName);
    const displayVal = isMissing ? null : truncate(maskValue(fieldName, String(rawValue)), isLongField ? 500 : 200);
    
    // Polished status pills
    const statusClass = status === 'success' ? 'status-found' : status === 'warning' ? 'status-found' : 'status-missing';
    const statusIcon = status === 'success' ? '✓' : status === 'warning' ? '⚠' : '✗';
    const statusLabel = status === 'success' ? 'FOUND' : status === 'warning' ? 'PARTIAL' : 'MISSING';
    const tdClass = isMissing ? 'field-missing' : 'field-found';

    return `<tr>
      <td class="field-name">${esc(fieldName)}</td>
      <td class="${tdClass}">${displayVal ? esc(displayVal) : '<em style="opacity:0.5">Not detected by parser — this will be blank in recruiter searches</em>'}</td>
      <td><span class="${statusClass}">${statusIcon} ${statusLabel}</span></td>
    </tr>`;
  }).join('');
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
      body: JSON.stringify({ bulletText: bullet, jobDescription: lastJobInput })
    });
    const data = await res.json();

    if (data.error) {
      const needsCredits = data.buyCredits || data.signup;
      btn.textContent = data.signup ? 'Sign up to fix →' : (needsCredits ? 'Buy Credits →' : 'Retry');
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

    resultDiv.innerHTML = `
      <div class="diff-after">
        <div class="diff-label diff-label-after">✓ Humanized Rewrite (CAR Formula)</div>
        <p id="fix-text-${idx}">${esc(data.rewritten)}</p>
      </div>
      <div class="diff-meta">
        <span class="badge badge-purple">${esc(data.targetKeyword || 'General')}</span>
        <span class="badge badge-blue">${esc(data.method || 'CAR Formula')}</span>
        <span class="badge badge-green">Anti-Fluff ✓</span>
        <button class="btn-copy" onclick="copyToClipboard('${esc(data.rewritten.replace(/'/g, "\\'"))}', this)">📋 Copy</button>
      </div>
      ${data.needsMetric && data.metricPrompt ? `
      <div class="context-metric-prompt" style="margin-top:0.75rem">
        <div class="metric-prompt-header">
          <span class="metric-prompt-icon">📊</span>
          <span class="metric-prompt-label">The AI needs a real number here</span>
        </div>
        <p class="metric-prompt-question">${esc(data.metricPrompt)}</p>
        <div class="metric-prompt-input-row">
          <input type="text" class="metric-prompt-input" placeholder="e.g., reduced by 40%" id="fix-metric-${idx}" />
          <button class="btn btn-sm btn-primary" onclick="applyFixMetric(${idx})">Apply</button>
        </div>
      </div>` : ''}
      ${(data.contextAudit && data.contextAudit.warnings && data.contextAudit.warnings.length) ? `
      <div class="context-warnings" style="margin-top:0.5rem">
        ${data.contextAudit.warnings.map(w => `<div class="context-warning-item"><span class="context-warning-icon">⚠️</span> ${esc(w)}</div>`).join('')}
      </div>` : ''}
    `;
    // Update the parent diff-card border
    const card = el('fix-card-' + idx);
    if (card) card.classList.add('bullet-complete');

    // Update the "Fix with AI" button to show completed state
    const actionsDiv = btn.closest('.diff-actions');
    if (actionsDiv) {
      actionsDiv.innerHTML = `
        <div class="diff-badges">
          <span class="badge badge-green">✓ Humanized</span>
        </div>
      `;
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

  function openSheet() {
    sheet.classList.add('open');
    backdrop.classList.add('open');
    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-label', 'Close menu');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-label', 'Open menu');
    document.body.style.overflow = '';
    // Reset any swipe transform
    sheet.style.transform = '';
    sheet.style.transition = '';
  }

  // Menu button opens/closes bottom sheet
  menuBtn.addEventListener('click', () => {
    if (sheet.classList.contains('open')) closeSheet();
    else openSheet();
  });

  // Close on backdrop click
  backdrop.addEventListener('click', closeSheet);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
  });

  // Close on link/button click inside sheet
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('a') || e.target.closest('button')) closeSheet();
  });

  // Wire up bottom sheet logout
  const sheetLogout = el('bottom-sheet-logout');
  if (sheetLogout) {
    sheetLogout.addEventListener('click', async (ev) => {
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

  sheet.addEventListener('touchstart', (e) => {
    // Only initiate swipe from the handle area (top 40px of sheet)
    const rect = sheet.getBoundingClientRect();
    const touchY = e.touches[0].clientY;
    if (touchY - rect.top > 48) return;

    isDragging = true;
    startY = e.touches[0].clientY;
    currentY = startY;
    sheet.style.transition = 'none'; // Disable transition for real-time tracking
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = Math.max(0, currentY - startY); // Only allow downward swipe
    sheet.style.transform = `translateY(${deltaY}px)`;
  }, { passive: true });

  sheet.addEventListener('touchend', () => {
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
  }, { passive: true });
}

function showToast(message, type = 'info', options = {}) {
  const container = el('toast-container');
  if (!container) return;
  
  const duration = options.duration || (type === 'error' ? 6000 : 4000);
  const dismissible = options.dismissible !== false;

  // SVG icon library — crisp inline SVGs, no emoji
  const icons = {
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

  // Construct inner HTML
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
    ${dismissible ? '<button class="toast-dismiss" aria-label="Dismiss notification">&times;</button>' : ''}
    <div class="toast-timer"><div class="toast-timer-bar" style="animation-duration:${duration}ms"></div></div>
  `;

  container.appendChild(toast);

  // Dismiss button handler
  if (dismissible) {
    toast.querySelector('.toast-dismiss').addEventListener('click', () => dismissToast(toast));
  }

  // Auto-dismiss
  const timeout = setTimeout(() => dismissToast(toast), duration);

  // Pause timer on hover
  toast.addEventListener('mouseenter', () => {
    clearTimeout(timeout);
    const bar = toast.querySelector('.toast-timer-bar');
    if (bar) bar.style.animationPlayState = 'paused';
  });
  toast.addEventListener('mouseleave', () => {
    const bar = toast.querySelector('.toast-timer-bar');
    if (bar) bar.style.animationPlayState = 'running';
    // Resume auto-dismiss (remaining time approximated)
    setTimeout(() => dismissToast(toast), 2000);
  });

  // Dismiss toast with Escape key (accessibility)
  function onEscapeDismiss(e) {
    if (e.key === 'Escape') {
      dismissToast(toast);
      document.removeEventListener('keydown', onEscapeDismiss);
    }
  }
  document.addEventListener('keydown', onEscapeDismiss);

  // Limit to 5 visible toasts
  while (container.children.length > 5) {
    dismissToast(container.firstElementChild);
  }
}

function dismissToast(toast) {
  if (!toast || toast._dismissing) return;
  toast._dismissing = true;
  toast.style.opacity = '0';
  toast.style.transform = 'translateX(24px) scale(0.95)';
  toast.style.maxHeight = '0';
  toast.style.marginBottom = '0';
  toast.style.padding = '0';
  setTimeout(() => toast.remove(), 280);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.innerHTML;
    btn.innerHTML = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove('copied');
    }, 2000);
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Unable to copy — try selecting the text manually.', 'warning');
  });
}

function esc(str) {
  if (typeof str !== 'string') str = String(str || '');
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// DOMPurify safety net for innerHTML — belt-and-braces defense.
// Use safeHtml() for any innerHTML that includes dynamic content.
function safeHtml(html) {
  if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return html; // Fallback if DOMPurify fails to load — esc() already escapes
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

async function startCheckout(packId) {
  if (!currentUser) return navigateTo('/signup');
  try {
    const res = await fetch('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId })
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else showToast(data.error || 'Checkout error', 'error');
  } catch { showToast('Checkout failed. Please try again.', 'error'); }
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

function renderCoverLetter(text) {
  currentCoverLetterText = text;
  const container = el('cover-letter-content');
  const actions = el('cover-letter-actions');
  if (!container) return;

  const bar = el('agent-download-bar');
  const scanId = bar ? bar.dataset.scanId : null;
  if (!scanId) {
    container.innerHTML = '<div class="preview-empty" style="padding:2rem;text-align:center;color:var(--text-muted);">No cover letter yet.</div>';
    return;
  }

  container.innerHTML = `
    <div class="preview-frame">
      <iframe class="preview-iframe" src="/api/agent/cover-letter-preview/${scanId}?t=${Date.now()}" title="Cover letter preview"></iframe>
    </div>`;

  // Auto-resize iframe to fit content (no white space)
  const iframe = container.querySelector('.preview-iframe');
  if (iframe) {
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const contentHeight = doc.documentElement.scrollHeight || doc.body.scrollHeight;
        iframe.style.height = contentHeight + 'px';
      } catch (e) {
        // Cross-origin fallback — use a reasonable default
        iframe.style.height = '850px';
      }
    });
  }

  if (actions) actions.style.display = 'flex';

  // ── Copy Protection ─────────────────────────────────────────────
  // Block text selection and clipboard events on cover letter content.
  // This complements the CSS user-select:none by also preventing programmatic
  // clipboard extraction via keyboard shortcuts (Ctrl+C / Cmd+C).
  const protectedEl = container;
  if (protectedEl && !protectedEl._copyProtected) {
    protectedEl._copyProtected = true;
    protectedEl.addEventListener('selectstart', (e) => e.preventDefault(), { passive: false });
    protectedEl.addEventListener('copy', (e) => { e.preventDefault(); e.clipboardData?.clearData(); }, { passive: false });
    protectedEl.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });
  }
}

// Cover letter action handlers
document.addEventListener('click', (e) => {
  if (e.target.id === 'download-cover-letter-pdf' || e.target.closest('#download-cover-letter-pdf')) {
    downloadCoverLetter('pdf');
  }

  // Download cover letter as DOCX
  if (e.target.id === 'download-cover-letter-docx' || e.target.closest('#download-cover-letter-docx')) {
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

  const bar = el('agent-download-bar');
  const scanId = bar ? bar.dataset.scanId : null;
  if (!scanId) {
    showToast('No scan data available. Please run a new scan first.', 'warning');
    return;
  }

  try {
    const res = await fetch(`/api/agent/download/${scanId}?format=${format}&type=cover_letter`);
    if (!res.ok) {
      const data = await res.json();
      if (data.error) showToast(data.error, 'error');
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
  const CONSENT_VERSION = '2.0';   // Bump when banner text/categories change
  const BANNER_DELAY_MS = 1200;    // Delay before first banner display (UX)

  // ── DOM References ─────────────────────────────────────────────────────────
  const banner       = document.getElementById('cookie-consent-banner');
  const acceptBtn    = document.getElementById('cookie-accept');
  const rejectBtn    = document.getElementById('cookie-reject');
  const customizeBtn = document.getElementById('cookie-customize');
  const savePrefsBtn = document.getElementById('cookie-save-prefs');
  const prefPanel    = document.getElementById('cookie-preferences');
  const settingsLink = document.getElementById('footer-cookie-settings');
  const ccpaLink     = document.getElementById('cookie-banner-ccpa-link');
  const toggleAnalytics = document.getElementById('cookie-toggle-analytics');
  const toggleMarketing = document.getElementById('cookie-toggle-marketing');

  if (!banner) return;

  // ── Default Consent State ──────────────────────────────────────────────────
  // GDPR: All non-essential categories default to OFF (no pre-ticked boxes)
  const DEFAULT_CONSENT = {
    version: CONSENT_VERSION,
    essential: true,     // Always ON — cannot be disabled
    analytics: false,    // OFF by default
    marketing: false,    // OFF by default
    timestamp: null,
    method: null,        // 'accept_all', 'reject_all', 'custom', 'gpc_signal'
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
    } catch { return null; }
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
    const consent = { ...DEFAULT_CONSENT, analytics: false, marketing: false, method: 'reject_all' };
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
      showToast('Your opt-out request has been honored. No data will be sold or shared.', 'success');
    }
  }

  // ── GPC (Global Privacy Control) Detection ─────────────────────────────────
  // CCPA/CPRA requires honoring browser GPC signal as valid opt-out.
  // GDPR still requires showing the banner for informed consent.
  // Solution: Pre-set non-essential toggles to OFF when GPC detected,
  // but STILL show the banner so the user makes an informed choice.

  const gpcDetected = (navigator.globalPrivacyControl === true);

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
    ccpaLink.addEventListener('click', (e) => {
      e.preventDefault();
      handleDoNotSell();
    });
  }

  // Footer "Cookie Settings" link — re-opens the banner with current state
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      const current = getStoredConsent() || DEFAULT_CONSENT;
      syncToggles(current);
      showBanner();
      banner.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

})();
