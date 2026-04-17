export function el(id) {
  return document.getElementById(id);
}

export function uiIcon(name, { size = 18, stroke = 2 } = {}) {
  const icons = {
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />',
    file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />',
    search:
      '<circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22,6 12,13 2,6" />',
    spark: '<path d="M12 2l2.3 5.4L20 10l-5.7 2.6L12 18l-2.3-5.4L4 10l5.7-2.6L12 2z" />',
    warning:
      '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />',
    chart: '<path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />',
    archive:
      '<path d="M22 12h-6l-2 3H10l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />',
    check: '<polyline points="20 6 9 17 4 12" />',
    dot: '<circle cx="12" cy="12" r="3" />',
  };

  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
}

export function announceToScreenReader(message, priorityOrType = 'polite') {
  let announcer = el('sr-announcer');
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = 'sr-announcer';
    announcer.className = 'visually-hidden';
    announcer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(announcer);
  }

  const liveMode =
    priorityOrType === 'error' || priorityOrType === 'assertive' ? 'assertive' : 'polite';
  announcer.setAttribute('aria-live', liveMode);
  announcer.textContent = '';

  window.setTimeout(() => {
    announcer.textContent = message;
  }, 100);
}

function addToNotificationLog(message, type) {
  let logContainer = document.getElementById('notification-log');
  if (!logContainer) {
    logContainer = document.createElement('div');
    logContainer.id = 'notification-log';
    logContainer.className = 'notification-log visually-hidden';
    logContainer.setAttribute('aria-label', 'Notification history');
    document.body.appendChild(logContainer);
  }

  const entry = document.createElement('div');
  entry.className = `notification-log-entry notification-log-entry--${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
  logContainer.appendChild(entry);

  while (logContainer.children.length > 20) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

export function dismissToast(toast) {
  if (!toast || toast._dismissing) return;
  toast._dismissing = true;

  if (toast._onEscapeDismiss) {
    document.removeEventListener('keydown', toast._onEscapeDismiss);
    toast._onEscapeDismiss = null;
  }

  toast.style.opacity = '0';
  toast.style.transform = 'translateX(24px) scale(0.95)';
  toast.style.maxHeight = '0';
  toast.style.marginBottom = '0';
  toast.style.padding = '0';
  window.setTimeout(() => toast.remove(), 280);
}

export function showToast(message, type = 'info', options = {}) {
  const container = el('toast-container');
  if (!container) return;

  const duration = options.duration || (type === 'error' ? 6000 : 4000);
  const dismissible = options.dismissible !== false;

  announceToScreenReader(message, type);

  if (type === 'error') {
    addToNotificationLog(message, type);
  }

  const icons = {
    success:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.innerHTML = safeHtml(`
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${esc(message)}</span>
    ${dismissible ? '<button class="toast-dismiss" aria-label="Dismiss notification">&times;</button>' : ''}
    <div class="toast-timer"><div class="toast-timer-bar" style="animation-duration:${duration}ms"></div></div>
  `);

  container.appendChild(toast);

  if (dismissible) {
    toast.querySelector('.toast-dismiss')?.addEventListener('click', () => dismissToast(toast));
  }

  const timeout = window.setTimeout(() => dismissToast(toast), duration);

  toast.addEventListener('mouseenter', () => {
    window.clearTimeout(timeout);
    const bar = toast.querySelector('.toast-timer-bar');
    if (bar) bar.style.animationPlayState = 'paused';
  });
  toast.addEventListener('mouseleave', () => {
    const bar = toast.querySelector('.toast-timer-bar');
    if (bar) bar.style.animationPlayState = 'running';
    window.setTimeout(() => dismissToast(toast), 2000);
  });

  function onEscapeDismiss(event) {
    if (event.key === 'Escape') dismissToast(toast);
  }
  toast._onEscapeDismiss = onEscapeDismiss;
  document.addEventListener('keydown', onEscapeDismiss);

  while (container.children.length > 5) {
    dismissToast(container.firstElementChild);
  }
}

export function copyToClipboard(text, btn) {
  return navigator.clipboard
    .writeText(text)
    .then(() => {
      const originalText = btn?.innerHTML;
      if (btn) {
        btn.innerHTML = '✓ Copied';
        btn.classList.add('copied');
      }
      window.setTimeout(() => {
        if (btn && typeof originalText === 'string') {
          btn.innerHTML = originalText;
          btn.classList.remove('copied');
        }
      }, 2000);
      showToast('Copied to clipboard!', 'success');
    })
    .catch(() => {
      showToast('Unable to copy — try selecting the text manually.', 'warning');
    });
}

export function esc(str) {
  if (typeof str !== 'string') str = String(str || '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str || '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

export function safeHtml(html) {
  const purifier = window.DOMPurify;
  if (purifier) {
    return purifier.sanitize(html, { USE_PROFILES: { html: true } });
  }
  return html;
}

export function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}
