/**
 * Scan Feature Module
 * Resume upload and analysis functionality
 */

import { el, formatFileSize } from '../core/utils.mjs';
import { navigateTo } from '../core/router.mjs';
import { upload, get } from '../core/api.mjs';
import { showToast } from '../../components/toast.mjs';
import { announceToScreenReader } from '../../core/accessibility.mjs';

// Constants
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['.pdf', '.docx', '.doc', '.txt'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
];

let currentFile = null;
let isScanning = false;

/**
 * Setup scan form functionality
 */
export function setupScanForm() {
  setupFileUpload();
  setupFormSubmission();
}

/**
 * Setup file upload drag & drop
 */
function setupFileUpload() {
  const uploadArea = el('upload-area');
  const fileInput = el('resume-file');
  if (!uploadArea || !fileInput) return;

  // Click to upload
  uploadArea.addEventListener('click', () => fileInput.click());

  // File selection
  fileInput.addEventListener('change', handleFileSelect);

  // Drag & drop
  uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });
}

/**
 * Handle file selection
 * @param {Event} e - Change event
 */
function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
}

/**
 * Validate and handle file
 * @param {File} file - Selected file
 */
function handleFile(file) {
  const errorEl = el('scan-error');
  errorEl.style.display = 'none';

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    showError(`File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}`);
    return;
  }

  // Check file type
  const extension = '.' + file.name.split('.').pop().toLowerCase();
  if (!ALLOWED_TYPES.includes(extension)) {
    showError(`Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
    return;
  }

  currentFile = file;

  // Update UI
  const preview = el('file-preview');
  const uploadArea = el('upload-area');
  const fileName = el('file-name');
  const fileSize = el('file-size');

  if (fileName) fileName.textContent = file.name;
  if (fileSize) fileSize.textContent = formatFileSize(file.size);

  if (preview) preview.style.display = 'block';
  if (uploadArea) {
    uploadArea.classList.add('file-selected');
    uploadArea.style.display = 'none';
  }

  // Enable submit button
  const submitBtn = el('scan-submit-btn');
  if (submitBtn) submitBtn.disabled = false;

  announceToScreenReader(`File selected: ${file.name}`);
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  const errorEl = el('scan-error');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  showToast(message, 'error');
}

/**
 * Setup form submission
 */
function setupFormSubmission() {
  const form = el('scan-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    if (!currentFile || isScanning) return;

    const jobInput = el('job-input');
    const jobUrl = el('job-url');

    const formData = new FormData();
    formData.append('resume', currentFile);
    formData.append('jobDescription', jobInput?.value?.trim() || '');
    formData.append('jobUrl', jobUrl?.value?.trim() || '');

    isScanning = true;

    // Show loading state
    const loadingEl = el('scan-loading');
    const formEl = el('scan-form');

    if (loadingEl) loadingEl.style.display = 'block';
    if (formEl) formEl.style.display = 'none';

    announceToScreenReader('Starting resume analysis...', 'polite');

    try {
      const result = await upload('/api/scan', formData, progress => {
        const progressEl = el('upload-progress');
        if (progressEl) {
          progressEl.style.width = `${progress}%`;
          progressEl.textContent = `${progress}%`;
        }
      });

      // Navigate to results
      navigateTo(`/results/${result.scanId}`);
      showToast('Analysis complete!', 'success');
    } catch (err) {
      showError(err.message || 'Analysis failed. Please try again.');

      if (loadingEl) loadingEl.style.display = 'none';
      if (formEl) formEl.style.display = 'block';
    } finally {
      isScanning = false;
    }
  });
}

/**
 * Reset scan form
 */
export function resetScanForm() {
  currentFile = null;
  isScanning = false;

  const form = el('scan-form');
  const preview = el('file-preview');
  const uploadArea = el('upload-area');
  const errorEl = el('scan-error');
  const submitBtn = el('scan-submit-btn');

  if (form) {
    form.reset();
    form.style.display = 'block';
  }
  if (preview) preview.style.display = 'none';
  if (uploadArea) {
    uploadArea.style.display = '';
    uploadArea.classList.remove('file-selected');
  }
  if (errorEl) errorEl.style.display = 'none';
  if (submitBtn) submitBtn.disabled = true;
}
