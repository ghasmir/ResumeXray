/**
 * Accessibility Module
 * Screen reader announcements, focus management, and ARIA helpers
 */

import { el } from './utils.js';

/**
 * Announce message to screen readers
 * @param {string} message - Message to announce
 * @param {'polite'|'assertive'} [priority='polite'] - Announcement priority
 */
export function announceToScreenReader(message, priority = 'polite') {
  const announcer = el('sr-announcer');
  if (!announcer) {
    console.warn('Screen reader announcer not found');
    return;
  }

  // Clear previous announcement
  announcer.textContent = '';
  announcer.setAttribute('aria-live', priority);

  // Delay to ensure clear happens first
  setTimeout(() => {
    announcer.textContent = message;
  }, 100);
}

/**
 * Trap focus within an element (for modals)
 * @param {HTMLElement} element - Container element
 * @returns {Function} Function to release focus trap
 */
export function trapFocus(element) {
  const focusableSelectors = [
    'a[href]',
    'button',
    'textarea',
    'input[type="text"]',
    'input[type="radio"]',
    'input[type="checkbox"]',
    'select',
    '[tabindex]:not([tabindex="-1"])',
  ];

  function getFocusableElements() {
    return Array.from(element.querySelectorAll(focusableSelectors.join(', '))).filter(
      el => !el.disabled && el.offsetParent !== null
    );
  }

  function handleKeyDown(e) {
    if (e.key !== 'Tab') return;

    const focusableElements = getFocusableElements();
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

  element.addEventListener('keydown', handleKeyDown);

  // Store previous focus
  const previousFocus = document.activeElement;

  return function release() {
    element.removeEventListener('keydown', handleKeyDown);
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
  };
}

/**
 * Set focus to element with visual indicator
 * @param {HTMLElement|string} target - Element or ID to focus
 * @param {boolean} [scroll=true] - Whether to scroll into view
 */
export function setFocus(target, scroll = true) {
  const element = typeof target === 'string' ? el(target) : target;
  if (!element) return;

  element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: !scroll });

  if (scroll) {
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Skip to main content link handler
 */
export function setupSkipLink() {
  const skipLink = document.querySelector('.skip-link');
  if (!skipLink) return;

  skipLink.addEventListener('click', e => {
    e.preventDefault();
    const mainContent = el('main-content');
    if (mainContent) {
      setFocus(mainContent);
    }
  });
}

/**
 * Make element live region for dynamic updates
 * @param {HTMLElement} element - Element to make live
 * @param {'polite'|'assertive'} [priority='polite'] - Live region priority
 */
export function makeLiveRegion(element, priority = 'polite') {
  element.setAttribute('aria-live', priority);
  element.setAttribute('aria-atomic', 'false');
  element.setAttribute('aria-relevant', 'additions text');
}

/**
 * Announce loading state to screen readers
 * @param {string} [message='Loading...'] - Loading message
 */
export function announceLoading(message = 'Loading...') {
  announceToScreenReader(message, 'polite');
}

/**
 * Announce success to screen readers
 * @param {string} message - Success message
 */
export function announceSuccess(message) {
  announceToScreenReader(message, 'polite');
}

/**
 * Announce error to screen readers
 * @param {string} message - Error message
 */
export function announceError(message) {
  announceToScreenReader(message, 'assertive');
}

/**
 * Setup reduced motion preferences
 */
export function setupReducedMotion() {
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  function handleChange(e) {
    document.documentElement.classList.toggle('reduced-motion', e.matches);
  }

  mediaQuery.addEventListener('change', handleChange);
  handleChange(mediaQuery);
}

/**
 * Create accessible modal
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} options.content - Modal content (HTML)
 * @param {Function} [options.onClose] - Close callback
 * @returns {Object} Modal controller
 */
export function createModal({ title, content, onClose }) {
  const modalId = `modal-${Date.now()}`;

  const modalHtml = `
    <div id="${modalId}" class="modal" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <header class="modal-header">
          <h2 id="${modalId}-title" class="modal-title">${title}</h2>
          <button class="modal-close" aria-label="Close">&times;</button>
        </header>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    </div>
  `;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = modalHtml;
  const modal = wrapper.firstElementChild;
  document.body.appendChild(modal);

  const releaseFocus = trapFocus(modal);
  document.body.style.overflow = 'hidden';

  function close() {
    releaseFocus();
    modal.remove();
    document.body.style.overflow = '';
    if (onClose) onClose();
  }

  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', close);
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });

  return { close, modal };
}
