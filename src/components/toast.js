/**
 * Toast Notification Component
 * Accessible toast notifications with auto-dismiss
 */

import { el } from '../core/utils.js';

const icons = {
  success:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

/**
 * Setup toast container
 */
export function setupToastContainer() {
  if (el('toast-container')) return;

  const container = document.createElement('div');
  container.id = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
  container.className = 'toast-container';
  document.body.appendChild(container);
}

/**
 * Show toast notification
 * @param {string} message - Toast message
 * @param {'success'|'error'|'warning'|'info'} [type='info'] - Toast type
 * @param {Object} [options] - Toast options
 * @param {number} [options.duration=4000] - Display duration
 * @param {boolean} [options.dismissible=true] - Whether dismissible
 */
export function showToast(message, type = 'info', options = {}) {
  const container = el('toast-container');
  if (!container) {
    console.warn('Toast container not found');
    return;
  }

  const duration = options.duration || (type === 'error' ? 6000 : 4000);
  const dismissible = options.dismissible !== false;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
    ${dismissible ? '<button class="toast-dismiss" aria-label="Dismiss notification">&times;</button>' : ''}
    <div class="toast-timer"><div class="toast-timer-bar" style="animation-duration:${duration}ms"></div></div>
  `;

  container.appendChild(toast);

  // Limit to 5 visible toasts
  while (container.children.length > 5) {
    dismissToast(container.firstElementChild);
  }

  // Auto-dismiss
  let timeoutId;
  if (duration > 0) {
    timeoutId = setTimeout(() => dismissToast(toast), duration);
  }

  // Pause on hover
  toast.addEventListener('mouseenter', () => {
    clearTimeout(timeoutId);
    const bar = toast.querySelector('.toast-timer-bar');
    if (bar) bar.style.animationPlayState = 'paused';
  });

  toast.addEventListener('mouseleave', () => {
    const bar = toast.querySelector('.toast-timer-bar');
    if (bar) bar.style.animationPlayState = 'running';
    timeoutId = setTimeout(() => dismissToast(toast), 2000);
  });

  // Dismiss button
  if (dismissible) {
    toast.querySelector('.toast-dismiss').addEventListener('click', () => {
      clearTimeout(timeoutId);
      dismissToast(toast);
    });
  }

  // Keyboard dismiss
  toast.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      clearTimeout(timeoutId);
      dismissToast(toast);
    }
  });
}

/**
 * Dismiss a toast
 * @param {HTMLElement} toast - Toast element to dismiss
 */
function dismissToast(toast) {
  if (!toast || toast._dismissing) return;
  toast._dismissing = true;

  toast.style.opacity = '0';
  toast.style.transform = 'translateX(24px) scale(0.95)';
  toast.style.maxHeight = '0';
  toast.style.marginBottom = '0';
  toast.style.padding = '0';

  setTimeout(() => {
    toast.remove();
  }, 280);
}
