/**
 * Dashboard Feature Module
 * User dashboard and scan history
 */

import { el, timeAgo, formatNumber, esc } from '../../core/utils.mjs';
import { getScanHistory } from '../../services/index.mjs';
import { appStore } from '../../core/state.mjs';

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

function getHistoryContainer() {
  return el('dash-scans-list') || el('scan-history-list');
}

/**
 * Setup scan history list
 */
function setupScanHistory() {
  const container = getHistoryContainer();
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
  const container = getHistoryContainer();
  if (!container) return;

  if (scans.length === 0 && currentPage === 1) {
    container.innerHTML = `
      <div class="empty-state card bento-glass text-center" style="padding:3rem">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin:0 auto 1rem">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <h3>Start with one target role</h3>
        <p>Upload a resume and job description to unlock recruiter-view feedback, keyword gaps, and export-ready recommendations.</p>
        <button class="btn btn-primary" data-action="navigate" data-path="/scan">
          Start First Scan
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
  const scanId = scan.id;
  const parseRate = Math.round(scan.parse_rate ?? scan.parseRate ?? 0);
  const matchRate = Math.round(scan.match_rate ?? scan.matchRate ?? 0);
  const createdAt = scan.created_at ?? scan.createdAt;
  const title = buildScanTitle(scan);
  const displayTitle = title.length > 65 ? `${title.slice(0, 65)}…` : title;
  const accentColor =
    Math.max(parseRate, matchRate) >= 80
      ? 'var(--green)'
      : Math.max(parseRate, matchRate) >= 50
        ? 'var(--amber)'
        : 'var(--red)';

  const card = document.createElement('a');
  card.className = 'card scan-history-card animate-fade-up';
  card.href = `/results/${scanId}`;
  card.setAttribute('data-link', '');
  card.setAttribute('aria-label', `View scan results for ${title}`);
  card.style.marginBottom = '1rem';
  card.style.borderLeft = `3px solid ${accentColor}`;
  card.style.padding = '1.25rem';
  card.innerHTML = `
    <div class="flex justify-between items-center gap-4">
      <div style="flex: 1; min-width: 0;">
        <h4 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin: 0 0 0.5rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${esc(title)}">
          ${esc(displayTitle)}
        </h4>
        <div style="display:flex; gap:0.5rem; align-items: center; flex-wrap:wrap;">
          ${buildScoreBadge(parseRate, 'Parse')}
          ${matchRate ? buildScoreBadge(matchRate, 'Match') : ''}
          <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 0.5rem; display: flex; align-items: center; gap: 4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            ${esc(timeAgo(createdAt))}
          </span>
        </div>
      </div>
      <div style="color: var(--text-muted); transition: transform 0.2s ease;" class="history-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14"></path>
          <path d="M12 5l7 7-7 7"></path>
        </svg>
      </div>
    </div>
  `;
  return card;
}

function buildScanTitle(scan) {
  const jobTitle = String(scan.job_title || scan.jobTitle || '').trim();
  const companyName = String(scan.company_name || scan.companyName || '').trim();
  const jobDescription = String(scan.job_description || scan.jobDescription || '').trim();

  if (jobTitle && companyName && !jobTitle.toLowerCase().includes(companyName.toLowerCase())) {
    return `${jobTitle}, ${companyName}`;
  }
  if (jobTitle) return jobTitle;
  if (companyName) return `Role at ${companyName}`;
  if (jobDescription) return 'Pasted Job Description';
  return 'General Scan';
}

function buildScoreBadge(score, label) {
  const tone =
    score >= 80
      ? 'background: rgba(34,197,94,0.14); color: var(--green); border-color: rgba(34,197,94,0.2);'
      : score >= 50
        ? 'background: rgba(251,191,36,0.12); color: var(--amber); border-color: rgba(251,191,36,0.2);'
        : 'background: rgba(239,68,68,0.12); color: var(--red); border-color: rgba(239,68,68,0.18);';

  return `
    <span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border:1px solid transparent; border-radius:999px; font-size:0.78rem; font-weight:600; ${tone}">
      <span>${score}%</span>
      <span style="opacity:0.8">${esc(label)}</span>
    </span>
  `;
}

/**
 * Setup dashboard stats
 */
function setupStats() {
  const hasDashboardStats =
    !!el('stat-scans-bento') || !!el('stat-resumes-bento') || !!el('dash-plan-bento');
  if (!hasDashboardStats) return;

  updateStats(appStore.get('user'));
  appStore.subscribe('user', user => {
    updateStats(user);
  });
}

/**
 * Update dashboard stats
 * @param {Object} user - User data
 */
function updateStats(user) {
  if (!user) return;

  const scansUsed = user.scansUsed || user.totalScans || 0;
  const credits = user.creditBalance || 0;
  const tier = user.tier || 'free';
  const tierNames = {
    free: 'FREE',
    starter: 'STARTER',
    pro: 'PRO',
    hustler: 'CAREER PLUS',
  };

  const freeScansEl = el('stat-scans-bento');
  const resumesEl = el('stat-resumes-bento');
  const scansProgressEl = el('progress-scans');
  const resumesProgressEl = el('progress-resumes');
  const planEl = el('dash-plan-bento');

  if (freeScansEl) freeScansEl.textContent = '∞ Free';
  if (resumesEl) resumesEl.textContent = formatNumber(scansUsed);
  if (scansProgressEl) scansProgressEl.style.width = '100%';
  if (resumesProgressEl) resumesProgressEl.style.width = scansUsed > 0 ? `${Math.min(100, scansUsed * 10)}%` : '0%';
  if (planEl) {
    const tierClass = tier === 'free' ? 'tier-free' : 'tier-pro';
    planEl.innerHTML = `
      <span id="dash-tier-badge" class="dash-tier-badge ${tierClass}">${tierNames[tier] || 'FREE'}</span>
      ${formatNumber(credits)} credits
    `;
  }
}
