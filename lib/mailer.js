/**
 * Mailer — Resend API (primary) + Nodemailer SMTP (fallback)
 *
 * Architecture:
 *   1. If RESEND_API_KEY is set → uses Resend API (higher deliverability, no SMTP)
 *   2. If SMTP_HOST is set → falls back to Nodemailer SMTP
 *   3. Neither set → logs warning, returns false (dev mode, no emails sent)
 *
 * Resend free tier: 3,000 emails/month, 100/day — plenty for a SaaS launch.
 *
 * Usage:
 *   const { sendVerificationEmail, sendPasswordResetEmail } = require('./mailer');
 *   await sendVerificationEmail('user@example.com', 'token123');
 */

const log = require('./logger');

const FROM_EMAIL = process.env.EMAIL_FROM || process.env.FROM_EMAIL || 'noreply@resumexray-production-5320.up.railway.app';
const FROM_NAME = 'ResumeXray AI';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ── Transport Selection ──────────────────────────────────────────────────────

let sendFn = null;
let transportName = 'none';

function getEmailDomain(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  const [, domain] = email.split('@');
  return domain || 'unknown';
}

if (process.env.RESEND_API_KEY) {
  // ── Resend API (preferred) ──────────────────────────────────────────────
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  sendFn = async ({ to, subject, html, text }) => {
    const payload = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    };
    if (text) payload.text = text;
    const { data, error } = await resend.emails.send(payload);
    if (error) throw new Error(error.message);
    return data.id;
  };
  transportName = 'resend';
  log.info('Email transport: Resend API');

} else if (process.env.SMTP_HOST) {
  // ── Nodemailer SMTP (fallback) ──────────────────────────────────────────
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT == '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  sendFn = async ({ to, subject, html, text }) => {
    const payload = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    };
    if (text) payload.text = text;
    const info = await transporter.sendMail(payload);
    return info.messageId;
  };
  transportName = 'smtp';
  log.info('Email transport: SMTP (nodemailer)');

} else {
  log.warn('No email transport configured (set RESEND_API_KEY or SMTP_HOST)');
}

// ── HTML Escape (prevents XSS in email templates) ─────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── HTML Template ─────────────────────────────────────────────────────────────

function createEmailTemplate(title, body, actionLabel, actionUrl) {
  // Escape all interpolated values to prevent HTML injection
  const safeTitle = escapeHtml(title);
  const safeActionLabel = escapeHtml(actionLabel);
  const safeActionUrl = escapeHtml(actionUrl);
  // body may contain intentional HTML (e.g. <br>) — sanitize only dangerous tags
  const safeBody = body.replace(/<(?!br\s*\/?\s*>)[^>]+>/gi, '');
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a202c; margin: 0; padding: 0; background-color: #f7fafc; }
        .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        .header { background: #1a202c; padding: 32px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; letter-spacing: -0.02em; }
        .content { padding: 40px; }
        .content h2 { font-size: 20px; font-weight: 700; margin-top: 0; color: #2d3748; }
        .content p { margin-bottom: 24px; color: #4a5568; }
        .btn { display: inline-block; padding: 12px 24px; background: #3182ce; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; text-align: center; }
        .footer { padding: 24px; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>ResumeXray</h1></div>
        <div class="content">
          <h2>${safeTitle}</h2>
          <p>${safeBody}</p>
          <div style="text-align:center; margin-top:32px;">
            <a href="${safeActionUrl}" class="btn">${safeActionLabel}</a>
          </div>
          <p style="margin-top:32px; font-size: 14px; opacity: 0.8;">If the button doesn't work, copy and paste this link: <br> ${safeActionUrl}</p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ResumeXray AI. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  // Plain text version for email clients that don't support HTML
  const text = [
    'ResumeXray',
    '',
    title,
    '',
    body.replace(/<[^>]*>/g, ''),
    '',
    `${actionLabel}: ${actionUrl}`,
    '',
    `(c) ${new Date().getFullYear()} ResumeXray AI. All rights reserved.`,
  ].join('\n');

  return { html, text };
}

// ── Email Functions ───────────────────────────────────────────────────────────

async function sendVerificationEmail(to, token) {
  if (!sendFn) {
    log.warn('Verification email skipped (no transport configured)', { to: to.substring(0, 3) + '***' });
    return false;
  }

  const verifyUrl = `${APP_URL}/verify/${token}`;

  try {
    const { html, text } = createEmailTemplate(
      'Ready to supercharge your career?',
      'Welcome to ResumeXray! Please confirm your email address to unlock full access to AI optimizations and downloads.',
      'Verify My Email',
      verifyUrl
    );
    const messageId = await sendFn({
      to,
      subject: 'Confirm your email — ResumeXray',
      html,
      text,
    });
    log.info('Verification email sent', {
      messageId,
      toDomain: getEmailDomain(to),
      transport: transportName,
    });
    return true;
  } catch (error) {
    log.error('Failed to send verification email', {
      error: error.message,
      toDomain: getEmailDomain(to),
      transport: transportName,
    });
    return false;
  }
}

async function sendPasswordResetEmail(to, token) {
  if (!sendFn) {
    log.warn('Password reset email skipped (no transport configured)', { to: to.substring(0, 3) + '***' });
    return false;
  }

  const resetUrl = `${APP_URL}/reset-password/${token}`;

  try {
    const { html, text } = createEmailTemplate(
      'Password Reset Request',
      'We received a request to reset your ResumeXray password. If you didn\'t make this request, you can safely ignore this email.',
      'Reset Password',
      resetUrl
    );
    const messageId = await sendFn({
      to,
      subject: 'Reset your password — ResumeXray',
      html,
      text,
    });
    log.info('Password reset email sent', {
      messageId,
      toDomain: getEmailDomain(to),
      transport: transportName,
    });
    return true;
  } catch (error) {
    log.error('Failed to send password reset email', {
      error: error.message,
      toDomain: getEmailDomain(to),
      transport: transportName,
    });
    return false;
  }
}

async function sendSSOLoginReminderEmail(to, provider) {
  if (!sendFn) {
    log.warn('SSO reminder email skipped (no transport configured)', { to: to.substring(0, 3) + '***' });
    return false;
  }

  const loginUrl = `${APP_URL}/login`;

  try {
    const { html, text } = createEmailTemplate(
      'Sign in with ' + provider,
      `You recently requested a password reset, but your account is linked to ${provider}. You don't have a password to reset — just click the button below and use "Continue with ${provider}" to sign in.<br><br>If you forgot your ${provider} password, you'll need to recover it directly through ${provider}.`,
      'Go to Login',
      loginUrl
    );
    const messageId = await sendFn({
      to,
      subject: 'Sign in with ' + provider + ' — ResumeXray',
      html,
      text,
    });
    log.info('SSO login reminder email sent', {
      messageId,
      provider,
      toDomain: getEmailDomain(to),
      transport: transportName,
    });
    return true;
  } catch (error) {
    log.error('Failed to send SSO login reminder email', {
      error: error.message,
      provider,
      toDomain: getEmailDomain(to),
      transport: transportName,
    });
    return false;
  }
}

module.exports = {
  getEmailDomain,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSSOLoginReminderEmail,
};
