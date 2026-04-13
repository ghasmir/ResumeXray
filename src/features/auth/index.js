/**
 * Auth Feature Module
 * Login, signup, password reset functionality
 */

import { el, debounce, getInitials } from '../core/utils.js';
import { navigateTo } from '../core/router.js';
import { post } from '../core/api.js';
import { fetchUser } from '../services/index.js';
import { showToast } from '../components/toast.js';

/**
 * Setup all auth forms
 */
export function setupAuthForms() {
  setupLoginForm();
  setupSignupForm();
  setupForgotPasswordForm();
  setupResetPasswordForm();
}

/**
 * Setup login form
 */
function setupLoginForm() {
  const form = el('login-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const errorEl = el('login-error');
    errorEl.style.display = 'none';

    const email = el('login-email').value.trim();
    const password = el('login-password').value;

    if (!email || !password) {
      errorEl.textContent = 'Please enter both email and password';
      errorEl.style.display = 'block';
      return;
    }

    try {
      await post('/auth/login', { email, password });
      await fetchUser();

      const redirect = sessionStorage.getItem('redirectAfterLogin');
      sessionStorage.removeItem('redirectAfterLogin');
      navigateTo(redirect || '/dashboard');

      showToast('Welcome back!', 'success');
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed. Please check your credentials.';
      errorEl.style.display = 'block';
    }
  });
}

/**
 * Setup signup form
 */
function setupSignupForm() {
  const form = el('signup-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const errorEl = el('signup-error');
    errorEl.style.display = 'none';

    const name = el('signup-name').value.trim();
    const email = el('signup-email').value.trim();
    const password = el('signup-password').value;

    // Validate password strength
    const passwordInput = el('signup-password');
    if (passwordInput._checkStrength) {
      const checks = passwordInput._checkStrength();
      const passed = Object.values(checks).filter(Boolean).length;
      if (passed < 3) {
        errorEl.textContent = 'Please create a stronger password';
        errorEl.style.display = 'block';
        return;
      }
    }

    try {
      await post('/auth/signup', { name, email, password });
      await fetchUser();

      showToast('Account created successfully!', 'success');
      navigateTo('/dashboard');
    } catch (err) {
      errorEl.textContent = err.message || 'Signup failed. Please try again.';
      errorEl.style.display = 'block';
    }
  });
}

/**
 * Setup forgot password form
 */
function setupForgotPasswordForm() {
  const form = el('forgot-password-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const errorEl = el('forgot-error');
    const successEl = el('forgot-success');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    const email = el('forgot-email').value.trim();

    try {
      await post('/auth/forgot-password', { email });
      successEl.textContent = 'Check your email for reset instructions';
      successEl.style.display = 'block';
      form.reset();
    } catch (err) {
      errorEl.textContent = err.message || 'Request failed. Please try again.';
      errorEl.style.display = 'block';
    }
  });
}

/**
 * Setup reset password form
 */
function setupResetPasswordForm() {
  const form = el('reset-password-form');
  if (!form) return;

  // Extract token from URL
  const token = window.location.pathname.split('/').pop();

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const errorEl = el('reset-error');
    errorEl.style.display = 'none';

    const password = el('reset-password').value;
    const confirmPassword = el('reset-confirm-password').value;

    if (password !== confirmPassword) {
      errorEl.textContent = 'Passwords do not match';
      errorEl.style.display = 'block';
      return;
    }

    try {
      await post('/auth/reset-password', { token, password });
      showToast('Password reset successful!', 'success');
      navigateTo('/login');
    } catch (err) {
      errorEl.textContent = err.message || 'Reset failed. Please try again.';
      errorEl.style.display = 'block';
    }
  });
}

/**
 * Setup password toggle buttons (show/hide)
 */
export function setupPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const inputId = toggle.dataset.target;
      const input = el(inputId);
      if (!input) return;

      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
      toggle.classList.toggle('visible', !isVisible);
    });
  });
}

/**
 * Setup password strength indicator
 * @param {string} inputId - Password input ID
 * @param {string} prefix - Prefix for related element IDs
 */
export function setupPasswordStrength(inputId, prefix) {
  const input = el(inputId);
  if (!input || input.dataset.strengthBound) return;

  input.dataset.strengthBound = '1';

  const container = el(`${prefix}-pw-strength`);
  const meter = el(`${prefix}-pw-meter`);
  const rules = {
    length: el(`${prefix}-rule-length`),
    number: el(`${prefix}-rule-number`),
    upper: el(`${prefix}-rule-upper`),
    special: el(`${prefix}-rule-special`),
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
    if (container && pw.length > 0) container.classList.add('visible');

    return checks;
  }

  // Debounced event listeners
  const debouncedCheck = debounce(checkPassword, 100);
  ['input', 'keyup', 'change', 'paste'].forEach(evt => {
    input.addEventListener(evt, debouncedCheck);
  });

  input.addEventListener('focus', () => {
    if (container && input.value.length > 0) container.classList.add('visible');
  });

  // Expose for form validation
  input._checkStrength = checkPassword;
}
