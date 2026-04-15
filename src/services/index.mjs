/**
 * Services Module
 * Business logic for user, scan, and credit management
 */

import { get, post, put, del } from '../core/api.mjs';
import { appStore } from '../core/state.mjs';

// Request deduplication cache
const requestCache = new Map();

/**
 * Deduplicate API requests
 * @param {string} key - Cache key
 * @param {Function} fn - Async function to execute
 * @returns {Promise<any>}
 */
async function dedupe(key, fn) {
  if (requestCache.has(key)) {
    return requestCache.get(key);
  }

  const promise = fn().finally(() => {
    setTimeout(() => requestCache.delete(key), 100);
  });

  requestCache.set(key, promise);
  return promise;
}

// ═══════════════════════════════════════════════════════════════
// USER SERVICES
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch current user
 * @returns {Promise<Object|null>} User object or null
 */
export async function fetchUser() {
  return dedupe('fetchUser', async () => {
    // Check if just logged out
    if (sessionStorage.getItem('rx_logged_out')) {
      sessionStorage.removeItem('rx_logged_out');
      appStore.set('user', null);
      return null;
    }

    try {
      const data = await get('/user/me');
      const user = data.user || data;

      appStore.set({
        user,
        credits: user.creditBalance || 0,
      });

      return user;
    } catch (err) {
      appStore.set('user', null);
      return null;
    }
  });
}

/**
 * Update user avatar
 * @param {File} file - Avatar image file
 * @returns {Promise<Object>} Updated user
 */
export async function updateAvatar(file) {
  const formData = new FormData();
  formData.append('avatar', file);

  const result = await put('/user/avatar', formData);
  const currentUser = appStore.get('user');

  if (currentUser && result.avatarUrl) {
    appStore.set('user', {
      ...currentUser,
      avatar: result.avatarUrl,
      avatarUrl: result.avatarUrl,
    });
  }

  return result;
}

/**
 * Change password
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @returns {Promise<Object>} Result
 */
export async function changePassword(currentPassword, newPassword) {
  return put('/user/password', { currentPassword, newPassword });
}

/**
 * Delete account
 * @param {string} confirmEmail - Email confirmation
 * @returns {Promise<Object>} Result
 */
export async function deleteAccount(confirmEmail) {
  const result = await del('/user/account', { confirmEmail });
  appStore.set('user', null);
  return result;
}

/**
 * Log out user
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await post('/auth/logout');
  } finally {
    sessionStorage.setItem('rx_logged_out', '1');
    appStore.set('user', null);
    window.location.href = '/';
  }
}

// ═══════════════════════════════════════════════════════════════
// SCAN SERVICES
// ═══════════════════════════════════════════════════════════════

/**
 * Create new scan
 * @param {FormData} formData - Scan data (resume + job description)
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<Object>} Scan result
 */
export async function createScan(formData, onProgress) {
  return post('/api/scan', formData);
}

/**
 * Get scan by ID
 * @param {string} scanId - Scan ID
 * @returns {Promise<Object>} Scan data
 */
export async function getScan(scanId) {
  return dedupe(`scan-${scanId}`, () => get(`/api/scan/${scanId}`));
}

/**
 * Get user's scan history
 * @param {Object} [options] - Query options
 * @param {number} [options.limit=20] - Number of results
 * @param {number} [options.offset=0] - Offset for pagination
 * @returns {Promise<Array>} Scan history
 */
export async function getScanHistory({ limit = 20, offset = 0 } = {}) {
  const data = await get('/user/dashboard');
  const scans = Array.isArray(data.scans) ? data.scans : [];
  return scans.slice(offset, offset + limit);
}

/**
 * Delete a scan
 * @param {string} scanId - Scan ID to delete
 * @returns {Promise<Object>} Result
 */
export async function deleteScan(scanId) {
  return del(`/api/scan/${scanId}`);
}

/**
 * Download optimized resume
 * @param {string} scanId - Scan ID
 * @param {string} format - Download format (pdf, docx)
 * @returns {Promise<Blob>} File blob
 */
export async function downloadResume(scanId, format = 'pdf') {
  const response = await fetch(`/api/agent/download/${scanId}?format=${encodeURIComponent(format)}`);
  if (!response.ok) throw new Error('Download failed');
  return response.blob();
}

// ═══════════════════════════════════════════════════════════════
// CREDIT SERVICES
// ═══════════════════════════════════════════════════════════════

/**
 * Get credit balance
 * @returns {Promise<number>} Credit balance
 */
export async function getCreditBalance() {
  const data = await get('/billing/credits');
  const balance = data.credits || data.balance || 0;
  appStore.set('credits', balance);
  return balance;
}

/**
 * Get credit transaction history
 * @returns {Promise<Array>} Transaction history
 */
export async function getCreditHistory() {
  const data = await get('/user/credit-history');
  return data.history || [];
}

/**
 * Create checkout session for credits
 * @param {string} packId - Credit pack ID
 * @returns {Promise<Object>} Checkout session
 */
export async function createCheckoutSession(packId) {
  return post('/billing/checkout', { packId });
}

/**
 * Use credit for action
 * @param {string} action - Action to use credit for
 * @returns {Promise<Object>} Result with remaining balance
 */
export async function useCredit(action) {
  const result = await post('/billing/use-credit', { action });
  if (result.balance !== undefined) {
    appStore.set('credits', result.balance);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// AI SERVICES
// ═══════════════════════════════════════════════════════════════

/**
 * Fix a bullet point with AI
 * @param {string} bulletText - Original bullet text
 * @param {string} [jobDescription] - Job description for context
 * @returns {Promise<Object>} Rewritten bullet
 */
export async function fixBullet(bulletText, jobDescription = '') {
  return post('/api/fix-bullet', { bulletText, jobDescription });
}

/**
 * Get ATS optimization suggestions
 * @param {string} scanId - Scan ID
 * @returns {Promise<Object>} Suggestions
 */
export async function getSuggestions(scanId) {
  return get(`/api/scan/${scanId}/suggestions`);
}
