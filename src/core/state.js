/**
 * State Management Module
 * Centralized application state with event-driven updates
 */

import { deepClone } from './utils.js';

/**
 * Create a reactive state store
 * @param {Object} initialState - Initial state object
 * @returns {Object} State store API
 */
export function createStore(initialState = {}) {
  let state = deepClone(initialState);
  const listeners = new Map();
  const globalListeners = new Set();

  /**
   * Get current state (clone to prevent mutations)
   * @param {string} [key] - Specific key to get
   * @returns {any} State value
   */
  function get(key) {
    if (key === undefined) return deepClone(state);
    return deepClone(state[key]);
  }

  /**
   * Set state value(s)
   * @param {string|Object} key - Key or object to merge
   * @param {any} [value] - Value to set (if key is string)
   */
  function set(key, value) {
    const prevState = deepClone(state);

    if (typeof key === 'object') {
      state = { ...state, ...key };
    } else {
      state = { ...state, [key]: value };
    }

    // Notify global listeners
    globalListeners.forEach(fn => fn(state, prevState));

    // Notify key-specific listeners
    if (typeof key === 'object') {
      Object.keys(key).forEach(k => {
        const keyListeners = listeners.get(k);
        if (keyListeners) {
          keyListeners.forEach(fn => fn(state[k], prevState[k]));
        }
      });
    } else {
      const keyListeners = listeners.get(key);
      if (keyListeners) {
        keyListeners.forEach(fn => fn(state[key], prevState[key]));
      }
    }
  }

  /**
   * Subscribe to state changes
   * @param {string|Function} key - Key to watch or callback for all changes
   * @param {Function} [callback] - Callback function (if key is string)
   * @returns {Function} Unsubscribe function
   */
  function subscribe(key, callback) {
    if (typeof key === 'function') {
      // Subscribe to all changes
      globalListeners.add(key);
      return () => globalListeners.delete(key);
    }

    // Subscribe to specific key
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    listeners.get(key).add(callback);

    return () => {
      listeners.get(key).delete(callback);
    };
  }

  /**
   * Reset state to initial or provided value
   * @param {Object} [newState] - New state to set
   */
  function reset(newState = initialState) {
    state = deepClone(newState);
    globalListeners.forEach(fn => fn(state, {}));
  }

  return {
    get,
    set,
    subscribe,
    reset,
  };
}

// Create global app store
export const appStore = createStore({
  user: null,
  scan: null,
  ui: {
    loading: false,
    error: null,
    currentView: 'landing',
  },
  credits: 0,
  settings: {
    theme: 'dark',
    reducedMotion: false,
  },
});

// Computed state helpers
export const getCurrentUser = () => appStore.get('user');
export const getCurrentScan = () => appStore.get('scan');
export const isAuthenticated = () => !!appStore.get('user');
export const getCreditBalance = () => appStore.get('credits');
