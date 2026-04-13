/**
 * API Client Module
 * Centralized HTTP client with CSRF protection and error handling
 */

import { appStore } from './state.js';

const API_BASE_URL = '';
let csrfToken = null;
let csrfPromise = null;

/**
 * Fetch CSRF token from server
 * @returns {Promise<string>} CSRF token
 */
export async function fetchCsrfToken() {
  if (csrfPromise) return csrfPromise;

  csrfPromise = fetch('/csrf-token')
    .then(res => res.json())
    .then(data => {
      csrfToken = data.csrfToken;
      return csrfToken;
    })
    .catch(err => {
      console.error('Failed to fetch CSRF token:', err);
      return null;
    })
    .finally(() => {
      csrfPromise = null;
    });

  return csrfPromise;
}

/**
 * Make authenticated API request
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  // Prepare headers
  const headers = {
    Accept: 'application/json',
    ...options.headers,
  };

  // Add CSRF token for mutating requests
  if (isMutating) {
    const token = await fetchCsrfToken();
    if (token) {
      headers['X-CSRF-Token'] = token;
    }
  }

  // Add content-type for JSON body
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin',
    });

    // Handle CSRF errors with auto-retry
    if (response.status === 403) {
      const data = await response.json().catch(() => ({}));
      if (data.error === 'Invalid CSRF token') {
        csrfToken = null; // Clear stale token
        const newToken = await fetchCsrfToken();
        if (newToken) {
          headers['X-CSRF-Token'] = newToken;
          return fetch(url, {
            ...options,
            headers,
            credentials: 'same-origin',
          });
        }
      }
    }

    return response;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

/**
 * GET request helper
 * @param {string} endpoint - API endpoint
 * @returns {Promise<any>} JSON response
 */
export async function get(endpoint) {
  const response = await apiRequest(endpoint);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * POST request helper
 * @param {string} endpoint - API endpoint
 * @param {Object} body - Request body
 * @returns {Promise<any>} JSON response
 */
export async function post(endpoint, body) {
  const response = await apiRequest(endpoint, {
    method: 'POST',
    body,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * PATCH request helper
 * @param {string} endpoint - API endpoint
 * @param {Object} body - Request body
 * @returns {Promise<any>} JSON response
 */
export async function patch(endpoint, body) {
  const response = await apiRequest(endpoint, {
    method: 'PATCH',
    body,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * DELETE request helper
 * @param {string} endpoint - API endpoint
 * @returns {Promise<any>} JSON response
 */
export async function del(endpoint) {
  const response = await apiRequest(endpoint, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Upload file with progress tracking
 * @param {string} endpoint - API endpoint
 * @param {FormData} formData - Form data with file
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<any>} JSON response
 */
export async function upload(endpoint, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          onProgress(percentComplete);
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve(xhr.responseText);
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('POST', endpoint);
    xhr.setRequestHeader('X-CSRF-Token', csrfToken || '');
    xhr.send(formData);
  });
}

// Initialize CSRF token on load
fetchCsrfToken();
