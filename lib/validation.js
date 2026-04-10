/**
 * Shared validation helpers — DRY password & email rules.
 * Used by: routes/auth.js (signup, reset-password), routes/user.js (password change)
 */

// §10.13: NIST 800-63B minimum 8 chars + at least one digit + uppercase
function validatePassword(password) {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters.' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter.' };
  }
  return { valid: true };
}

// §10.14: Email format validation (RFC 5322 simplified)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  return { valid: true };
}

module.exports = { validatePassword, validateEmail };
