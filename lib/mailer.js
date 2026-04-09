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

const FROM_EMAIL = process.env.EMAIL_FROM || process.env.FROM_EMAIL || 'noreply@resumexray.pro';
const FROM_NAME = 'ResumeXray AI';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ── Transport Selection ──────────────────────────────────────────────────────

let sendFn = null;

if (process.env.RESEND_API_KEY) {
  // ── Resend API (preferred) ──────────────────────────────────────────────
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  sendFn = async ({ to, subject, html }) => {
    const { data, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    });
    if (error) throw new Error(error.message);
    return data.id;
  };
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

  sendFn = async ({ to, subject, html }) => {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    });
    return info.messageId;
  };
  log.info('Email transport: SMTP (nodemailer)');

} else {
  log.warn('No email transport configured (set RESEND_API_KEY or SMTP_HOST)');
}

// ── HTML Template ─────────────────────────────────────────────────────────────

function createEmailTemplate(title, body, actionLabel, actionUrl) {
  return `
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
          <h2>${title}</h2>
          <p>${body}</p>
          <div style="text-align:center; margin-top:32px;">
            <a href="${actionUrl}" class="btn">${actionLabel}</a>
          </div>
          <p style="margin-top:32px; font-size: 14px; opacity: 0.8;">If the button doesn't work, copy and paste this link: <br> ${actionUrl}</p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ResumeXray AI. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;
}

// ── Email Functions ───────────────────────────────────────────────────────────

async function sendVerificationEmail(to, token) {
  if (!sendFn) {
    log.warn('Verification email skipped (no transport configured)', { to: to.substring(0, 3) + '***' });
    return false;
  }

  const verifyUrl = `${APP_URL}/verify/${token}`;

  try {
    const messageId = await sendFn({
      to,
      subject: 'Confirm your email — ResumeXray',
      html: createEmailTemplate(
        'Ready to supercharge your career?',
        'Welcome to ResumeXray! Please confirm your email address to unlock full access to AI optimizations and downloads.',
        'Verify My Email',
        verifyUrl
      ),
    });
    log.info('Verification email sent', { messageId });
    return true;
  } catch (error) {
    log.error('Failed to send verification email', { error: error.message });
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
    const messageId = await sendFn({
      to,
      subject: 'Reset your password — ResumeXray',
      html: createEmailTemplate(
        'Password Reset Request',
        'We received a request to reset your ResumeXray password. If you didn\'t make this request, you can safely ignore this email.',
        'Reset Password',
        resetUrl
      ),
    });
    log.info('Password reset email sent', { messageId });
    return true;
  } catch (error) {
    log.error('Failed to send password reset email', { error: error.message });
    return false;
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
