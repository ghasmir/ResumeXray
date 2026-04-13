/**
 * Router Module
 * SPA routing with history API and view management
 */

import { appStore } from './state.mjs';
import { el } from './utils.mjs';

// Route definitions
const routes = {
  '/': { view: 'landing', requiresAuth: false },
  '/scan': { view: 'scan', requiresAuth: false },
  '/results/:id': { view: 'results', requiresAuth: false },
  '/dashboard': { view: 'dashboard', requiresAuth: true },
  '/profile': { view: 'profile', requiresAuth: true },
  '/pricing': { view: 'pricing', requiresAuth: false },
  '/login': { view: 'login', requiresAuth: false, guestOnly: true },
  '/signup': { view: 'signup', requiresAuth: false, guestOnly: true },
  '/forgot-password': { view: 'forgot-password', requiresAuth: false, guestOnly: true },
  '/reset-password/:token': { view: 'reset-password', requiresAuth: false, guestOnly: true },
};

let currentRoute = null;
let beforeEachHook = null;
let afterEachHook = null;

/**
 * Parse route pattern and extract parameters
 * @param {string} pattern - Route pattern (e.g., "/user/:id")
 * @param {string} path - Actual path (e.g., "/user/123")
 * @returns {Object|null} Parameters or null if no match
 */
function matchRoute(pattern, path) {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      const paramName = patternParts[i].slice(1);
      params[paramName] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

/**
 * Find matching route for path
 * @param {string} path - Current path
 * @returns {Object|null} Route config or null
 */
function findRoute(path) {
  for (const [pattern, config] of Object.entries(routes)) {
    const params = matchRoute(pattern, path);
    if (params !== null) {
      return { pattern, config, params };
    }
  }
  return null;
}

/**
 * Navigate to a route
 * @param {string} path - Path to navigate to
 * @param {boolean} [pushState=true] - Whether to push to history
 * @returns {Promise<boolean>} Success status
 */
export async function navigateTo(path, pushState = true) {
  const user = appStore.get('user');
  const isAuthenticated = !!user;

  // Find matching route
  const route = findRoute(path);

  if (!route) {
    console.warn('Route not found:', path);
    navigateTo('/');
    return false;
  }

  // Check authentication requirements
  if (route.config.requiresAuth && !isAuthenticated) {
    sessionStorage.setItem('redirectAfterLogin', path);
    navigateTo('/login');
    return false;
  }

  // Check guest-only routes
  if (route.config.guestOnly && isAuthenticated) {
    navigateTo('/dashboard');
    return false;
  }

  // Run before hook
  if (beforeEachHook) {
    const result = await beforeEachHook(route, currentRoute);
    if (result === false) return false;
  }

  // Update history
  if (pushState) {
    window.history.pushState({ path }, '', path);
  }

  // Store params in app state
  appStore.set('route', {
    path,
    params: route.params,
    pattern: route.pattern,
  });

  // Hide all views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
    view.setAttribute('aria-hidden', 'true');
  });

  // Show target view
  const viewId = `view-${route.config.view}`;
  const targetView = el(viewId);
  if (targetView) {
    targetView.classList.add('active');
    targetView.setAttribute('aria-hidden', 'false');
    targetView.focus({ preventScroll: true });
  }

  // Update document title
  updatePageTitle(route.config.view, route.params);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Update current route
  currentRoute = route;

  // Run after hook
  if (afterEachHook) {
    await afterEachHook(route, currentRoute);
  }

  // Trigger route-specific event
  window.dispatchEvent(
    new CustomEvent('routechange', {
      detail: { route: currentRoute, prevRoute: currentRoute },
    })
  );

  return true;
}

/**
 * Update page title based on route
 * @param {string} view - View name
 * @param {Object} params - Route parameters
 */
function updatePageTitle(view, params) {
  const titles = {
    landing: 'ResumeXray — Free ATS Resume Scanner & Optimizer',
    scan: 'Scan Your Resume — ResumeXray',
    results: 'Scan Results — ResumeXray',
    dashboard: 'Dashboard — ResumeXray',
    profile: 'Profile — ResumeXray',
    pricing: 'Pricing — ResumeXray',
    login: 'Log In — ResumeXray',
    signup: 'Sign Up — ResumeXray',
  };

  document.title = titles[view] || 'ResumeXray';
}

/**
 * Register navigation link handlers
 */
export function setupRouter() {
  console.log('Router: Setting up...');

  // Handle click on data-link elements
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-link]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('http')) return;

    e.preventDefault();
    console.log('Router: Navigating to', href);
    navigateTo(href);
  });

  // Handle browser back/forward
  window.addEventListener('popstate', e => {
    const path = e.state?.path || window.location.pathname;
    console.log('Router: Popstate to', path);
    navigateTo(path, false);
  });

  // Handle initial route - but don't call it here, let init() do it
  console.log('Router: Setup complete');
}

/**
 * Register beforeEach hook
 * @param {Function} fn - Hook function
 */
export function beforeEach(fn) {
  beforeEachHook = fn;
}

/**
 * Register afterEach hook
 * @param {Function} fn - Hook function
 */
export function afterEach(fn) {
  afterEachHook = fn;
}

/**
 * Get current route
 * @returns {Object|null} Current route
 */
export function getCurrentRoute() {
  return currentRoute;
}

/**
 * Check if route is active
 * @param {string} pattern - Route pattern to check
 * @returns {boolean}
 */
export function isActiveRoute(pattern) {
  if (!currentRoute) return false;
  return currentRoute.pattern === pattern;
}

/**
 * Add new route dynamically
 * @param {string} pattern - Route pattern
 * @param {Object} config - Route configuration
 */
export function addRoute(pattern, config) {
  routes[pattern] = config;
}
