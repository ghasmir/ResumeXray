const { PLANS } = require('../config/stripe');

// Check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Please log in to continue.' });
}

// Check if user has Pro or Expert plan
function isPro(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Please log in.' });
  if (req.user.plan === 'pro' || req.user.plan === 'expert') return next();
  res.status(403).json({ error: 'Pro plan required. Upgrade to access this feature.', upgrade: true });
}

// Check if user has Expert plan
function isExpert(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Please log in.' });
  if (req.user.plan === 'expert') return next();
  res.status(403).json({ error: 'Expert plan required. Upgrade to access this feature.', upgrade: true });
}

// Optional auth — attaches user if logged in, continues regardless
function optionalAuth(req, res, next) {
  next();
}

module.exports = { isAuthenticated, isPro, isExpert, optionalAuth };
