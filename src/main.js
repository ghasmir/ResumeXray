/**
 * Main Application Entry Point
 * ResumeXray V5 - Modular Architecture
 */

// ═══════════════════════════════════════════════════════════════
// CORE IMPORTS
// ═══════════════════════════════════════════════════════════════

import { setupRouter, navigateTo } from './core/router.js';
import { appStore } from './core/state.js';
import { setupSkipLink, setupReducedMotion } from './core/accessibility.js';
import { fetchUser } from './services/index.js';
import { el, debounce, getInitials } from './core/utils.js';

// ═══════════════════════════════════════════════════════════════
// FEATURE IMPORTS
// ═══════════════════════════════════════════════════════════════

import { setupAuthForms, setupPasswordToggles } from './features/auth/index.js';
import { setupScanForm } from './features/scan/index.js';
import { setupDashboard } from './features/dashboard/index.js';
import { setupProfile } from './features/profile/index.js';

// ═══════════════════════════════════════════════════════════════
// COMPONENT IMPORTS
// ═══════════════════════════════════════════════════════════════

import { setupToastContainer, showToast } from './components/toast.js';
import { setupModal } from './components/modal.js';

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE (for backward compatibility during migration)
// ═══════════════════════════════════════════════════════════════

let currentUser = null;
let currentScan = null;

// ═══════════════════════════════════════════════════════════════
// ERROR REPORTING
// ═══════════════════════════════════════════════════════════════

function initErrorReporting() {
  let errorCount = 0;
  const MAX_ERRORS = 5;

  function reportError(payload) {
    if (errorCount >= MAX_ERRORS) return;
    errorCount++;
    try {
      navigator.sendBeacon('/api/client-error', JSON.stringify(payload));
    } catch {}
  }

  window.onerror = function (message, source, line, column, error) {
    reportError({
      message,
      source,
      line,
      column,
      stack: error?.stack,
      type: 'onerror',
    });
  };

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason;
    reportError({
      message: reason?.message || String(reason),
      stack: reason?.stack,
      type: 'unhandledrejection',
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION & UI
// ═══════════════════════════════════════════════════════════════

function updateNavUI(user) {
  const isAuthenticated = !!user;

  // Update avatar
  if (isAuthenticated && user) {
    const initials = getInitials(user.name);
    const avatarEl = el('nav-avatar-initials');
    if (avatarEl) avatarEl.textContent = initials;

    if (user.avatarUrl && el('nav-avatar')) {
      const safeUrl =
        user.avatarUrl.startsWith('https://') || user.avatarUrl.startsWith('/')
          ? user.avatarUrl
          : '';
      if (safeUrl) {
        const img = document.createElement('img');
        img.src = safeUrl;
        img.alt = user.name || 'User';
        el('nav-avatar').innerHTML = '';
        el('nav-avatar').appendChild(img);
      }
    }

    // Update credits
    const creditsEl = el('nav-credits-count');
    if (creditsEl) creditsEl.textContent = user.creditBalance || 0;
  }

  // Show/hide navigation areas
  const userArea = el('nav-user-area');
  const guestArea = el('nav-guest-area');
  const dashboardLink = el('nav-link-dashboard');
  const sheetAuthArea = el('sheet-auth-area');
  const sheetGuestArea = el('sheet-guest-area');
  const sheetDashboardLink = el('sheet-link-dashboard');

  if (userArea) userArea.style.display = isAuthenticated ? 'flex' : 'none';
  if (guestArea) guestArea.style.display = isAuthenticated ? 'none' : 'flex';
  if (dashboardLink) dashboardLink.style.display = isAuthenticated ? 'inline-flex' : 'none';
  if (sheetAuthArea) sheetAuthArea.style.display = isAuthenticated ? 'block' : 'none';
  if (sheetGuestArea) sheetGuestArea.style.display = isAuthenticated ? 'none' : 'block';
  if (sheetDashboardLink) sheetDashboardLink.style.display = isAuthenticated ? 'flex' : 'none';
}

function setupGlobalEventListeners() {
  // Handle navigation clicks on dynamic content
  document.addEventListener('click', e => {
    const actionEl = e.target.closest('[data-action="navigate"]');
    if (actionEl) {
      const path = actionEl.dataset.path;
      if (path) {
        e.preventDefault();
        navigateTo(path);
      }
    }
  });

  // Update navigation when auth state changes
  appStore.subscribe('user', user => {
    currentUser = user;
    updateNavUI(user);
  });
}

// ═══════════════════════════════════════════════════════════════
// MOBILE MENU
// ═══════════════════════════════════════════════════════════════

function setupMobileMenu() {
  const menuBtn = el('mobile-menu-btn');
  const sheet = el('bottom-sheet');
  const backdrop = el('bottom-sheet-backdrop');

  if (!menuBtn || !sheet || !backdrop) return;
  if (menuBtn._bound) return;
  menuBtn._bound = true;

  let focusTrapCleanup = null;
  let lastFocusedElement = null;

  function getFocusableElements(container) {
    return Array.from(
      container.querySelectorAll(
        'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.disabled && el.offsetParent !== null);
  }

  function trapFocus(container) {
    function handleKeyDown(e) {
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
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }

  function openSheet() {
    lastFocusedElement = document.activeElement;
    sheet.classList.add('open');
    backdrop.classList.add('open');
    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-label', 'Close menu');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    focusTrapCleanup = trapFocus(sheet);
    const firstFocusable = getFocusableElements(sheet)[0];
    if (firstFocusable) firstFocusable.focus();
  }

  function closeSheet() {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-label', 'Open menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';

    if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }

    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  menuBtn.addEventListener('click', () => {
    if (sheet.classList.contains('open')) closeSheet();
    else openSheet();
  });

  backdrop.addEventListener('click', closeSheet);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
  });

  sheet.addEventListener('click', e => {
    if (e.target.closest('a') || e.target.closest('button')) closeSheet();
  });

  // Swipe to dismiss
  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  sheet.addEventListener(
    'touchstart',
    e => {
      const rect = sheet.getBoundingClientRect();
      const touchY = e.touches[0].clientY;
      if (touchY - rect.top > 48) return;

      isDragging = true;
      startY = e.touches[0].clientY;
      currentY = startY;
      sheet.style.transition = 'none';
    },
    { passive: true }
  );

  sheet.addEventListener(
    'touchmove',
    e => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const deltaY = Math.max(0, currentY - startY);
      sheet.style.transform = `translateY(${deltaY}px)`;
    },
    { passive: true }
  );

  sheet.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    const deltaY = currentY - startY;
    sheet.style.transition = '';

    if (deltaY > 100) {
      closeSheet();
    } else {
      sheet.style.transform = 'translateY(0)';
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

async function init() {
  console.log('🚀 ResumeXray initializing...');

  // Initialize error reporting
  initErrorReporting();

  // Setup accessibility features
  setupSkipLink();
  setupReducedMotion();

  // Setup UI components
  setupToastContainer();
  setupModal();

  // Setup router
  setupRouter();

  // Setup global event listeners
  setupGlobalEventListeners();

  // Setup mobile menu
  setupMobileMenu();

  // Initialize features
  setupAuthForms();
  setupPasswordToggles();
  setupScanForm();
  setupDashboard();
  setupProfile();

  // Fetch user session
  try {
    const user = await fetchUser();
    currentUser = user;
    updateNavUI(user);
  } catch (err) {
    console.log('No active session');
  }

  // Navigate to initial route
  const initialPath = window.location.pathname;
  if (initialPath === '/' && currentUser) {
    navigateTo('/dashboard');
  } else {
    navigateTo(initialPath, false);
  }

  console.log('✅ ResumeXray initialized');
}

// Start application
document.addEventListener('DOMContentLoaded', init);

// Expose globals for backward compatibility (will be removed in future)
window.navigateTo = navigateTo;
window.showToast = showToast;
