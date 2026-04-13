/**
 * Dashboard Feature Module
 * User dashboard and scan history
 */

import { el, timeAgo, formatNumber } from '../core/utils.js';
import { navigateTo } from '../core/router.js';
import { getScanHistory, deleteScan, downloadResume } from '../../services/index.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

let currentPage = 1;
const ITEMS_PER_PAGE = 10;
let isLoading = false;

/**
 * Setup dashboard functionality
 */
export function setupDashboard() {
  setupScanHistory();
  setupStats();
}

/**
 * Setup scan history list
 */
function setupScanHistory() {
  const container = el('scan-history-list');
  if (!container) return;

  // Load initial history
  loadScanHistory();

  // Setup pagination
  const loadMoreBtn = el('load-more-scans');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      currentPage++;
      loadScanHistory();
    });
  }
}

/**
 * Load scan history from API
 */
async function loadScanHistory() {
  if (isLoading) return;
  isLoading = true;

  const container = el('scan-history-list');
  const loadingEl = el('history-loading');

  if (loadingEl) loadingEl.style.display = 'block';

  try {
    const scans = await getScanHistory({
      limit: ITEMS_PER_PAGE,
      offset: (currentPage - 1) * ITEMS_PER_PAGE,
    });

    renderScanList(scans);

    // Hide load more button if no more results
    const loadMoreBtn = el('load-more-scans');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = scans.length < ITEMS_PER_PAGE ? 'none' : 'block';
    }
  } catch (err) {
    showToast('Failed to load scan history', 'error');
    console.error('Failed to load scans:', err);
  } finally {
    isLoading = false;
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

/**
 * Render scan list
 * @param {Array} scans - Scan data array
 */
function renderScanList(scans) {
  const container = el('scan-history-list');
  if (!container) return;

  if (scans.length === 0 && currentPage === 1) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <h3>No scans yet</h3>
        <p>Upload your first resume to get started</p>
        <button class="btn btn-primary" data-action="navigate" data-path="/scan">
          Analyze Resume
        </button>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  scans.forEach(scan => {
    const card = createScanCard(scan);
    fragment.appendChild(card);
  });

  if (currentPage === 1) {
    container.innerHTML = '';
  }
  container.appendChild(fragment);
}

/**
 * Create scan card element
 * @param {Object} scan - Scan data
 * @returns {HTMLElement} Card element
 */
function createScanCard(scan) {
  const card = document.createElement('div');
  card.className = 'scan-card';
  card.dataset.scanId = scan.id;

  const score = Math.round((scan.parseRate + scan.formatHealth + scan.matchRate) / 3);

  card.innerHTML = `
    <div class="scan-card-header">
      <h4 class="scan-title">${scan.jobTitle || 'Untitled Scan'}</h4>
      <span class="scan-date">${timeAgo(scan.createdAt)}</span>
    </div>
    <div class="scan-card-body">
      <div class="scan-scores">
        <div class="score-item">
          <span class="score-value">${scan.parseRate}%</span>
          <span class="score-label">Parse</span>
        </div>
        <div class="score-item">
          <span class="score-value">${scan.formatHealth}%</span>
          <span class="score-label">Format</span>
        </div>
        <div class="score-item">
          <span class="score-value">${scan.matchRate}%</span>
          <span class="score-label">Match</span>
        </div>
      </div>
    </div>
    <div class="scan-card-footer">
      <button class="btn btn-sm btn-secondary" data-action="view">View</button>
      <button class="btn btn-sm btn-primary" data-action="download">Download</button>
      <button class="btn btn-sm btn-ghost" data-action="delete">Delete</button>
    </div>
  `;

  // Event listeners
  card.querySelector('[data-action="view"]').addEventListener('click', () => {
    navigateTo(`/results/${scan.id}`);
  });

  card.querySelector('[data-action="download"]').addEventListener('click', () => {
    handleDownload(scan.id);
  });

  card.querySelector('[data-action="delete"]').addEventListener('click', () => {
    handleDelete(scan.id, card);
  });

  return card;
}

/**
 * Handle resume download
 * @param {string} scanId - Scan ID
 */
async function handleDownload(scanId) {
  try {
    const blob = await downloadResume(scanId, 'pdf');
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `optimized-resume-${scanId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    showToast('Download started', 'success');
  } catch (err) {
    showToast('Download failed', 'error');
  }
}

/**
 * Handle scan deletion
 * @param {string} scanId - Scan ID
 * @param {HTMLElement} card - Card element to remove
 */
async function handleDelete(scanId, card) {
  const confirmed = await confirmDialog(
    'Are you sure you want to delete this scan? This action cannot be undone.',
    'Delete Scan'
  );

  if (!confirmed) return;

  try {
    await deleteScan(scanId);
    card.style.opacity = '0';
    setTimeout(() => card.remove(), 300);
    showToast('Scan deleted', 'success');
  } catch (err) {
    showToast('Failed to delete scan', 'error');
  }
}

/**
 * Setup dashboard stats
 */
function setupStats() {
  const statsContainer = el('dashboard-stats');
  if (!statsContainer) return;

  // Stats are updated when user data changes
  window.addEventListener('userUpdated', e => {
    updateStats(e.detail.user);
  });
}

/**
 * Update dashboard stats
 * @param {Object} user - User data
 */
function updateStats(user) {
  if (!user) return;

  const totalScansEl = el('stat-total-scans');
  const creditsEl = el('stat-credits');
  const tierEl = el('stat-tier');

  if (totalScansEl) totalScansEl.textContent = formatNumber(user.totalScans || 0);
  if (creditsEl) creditsEl.textContent = formatNumber(user.creditBalance || 0);
  if (tierEl) tierEl.textContent = user.tier || 'Free';
}
