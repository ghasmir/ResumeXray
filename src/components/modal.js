/**
 * Modal Component
 * Accessible modal dialogs with focus management
 */

import { trapFocus } from '../core/accessibility.js';
import { esc } from '../core/utils.js';

let activeModal = null;

/**
 * Setup modal system
 */
export function setupModal() {
  // Close active modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && activeModal) {
      activeModal.close();
    }
  });
}

/**
 * Create and show a modal
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} options.content - Modal content (HTML)
 * @param {string} [options.size='medium'] - Modal size (small, medium, large)
 * @param {boolean} [options.closeOnBackdrop=true] - Close when clicking backdrop
 * @param {Function} [options.onClose] - Callback when modal closes
 * @returns {Object} Modal controller with close method
 */
export function createModal({ title, content, size = 'medium', closeOnBackdrop = true, onClose }) {
  // Close any existing modal
  if (activeModal) {
    activeModal.close();
  }

  const modalId = `modal-${Date.now()}`;

  const modalHtml = `
    <div id="${modalId}" class="modal modal-${size}" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <header class="modal-header">
          <h2 id="${modalId}-title" class="modal-title">${esc(title)}</h2>
          <button class="modal-close" aria-label="Close modal">&times;</button>
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

  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  // Setup focus trap
  const releaseFocus = trapFocus(modal);

  // Close function
  function close() {
    if (activeModal !== modalController) return;

    releaseFocus();
    modal.classList.add('modal-closing');

    setTimeout(() => {
      modal.remove();
      document.body.style.overflow = '';
      activeModal = null;
      if (onClose) onClose();
    }, 200);
  }

  // Event listeners
  modal.querySelector('.modal-close').addEventListener('click', close);

  if (closeOnBackdrop) {
    modal.querySelector('.modal-backdrop').addEventListener('click', close);
  }

  // Store reference
  const modalController = { close, modal };
  activeModal = modalController;

  return modalController;
}

/**
 * Show confirmation dialog
 * @param {string} message - Confirmation message
 * @param {string} [title='Confirm'] - Dialog title
 * @returns {Promise<boolean>} User confirmed
 */
export function confirmDialog(message, title = 'Confirm') {
  return new Promise(resolve => {
    const content = `
      <p>${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="confirm">Confirm</button>
      </div>
    `;

    const modal = createModal({
      title,
      content,
      size: 'small',
      onClose: () => resolve(false),
    });

    modal.modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      modal.close();
      resolve(false);
    });

    modal.modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      modal.close();
      resolve(true);
    });
  });
}

/**
 * Show alert dialog
 * @param {string} message - Alert message
 * @param {string} [title='Alert'] - Dialog title
 * @returns {Promise<void>}
 */
export function alertDialog(message, title = 'Alert') {
  return new Promise(resolve => {
    const content = `
      <p>${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-primary" data-action="ok">OK</button>
      </div>
    `;

    const modal = createModal({
      title,
      content,
      size: 'small',
      onClose: () => resolve(),
    });

    modal.modal.querySelector('[data-action="ok"]').addEventListener('click', () => {
      modal.close();
      resolve();
    });
  });
}
