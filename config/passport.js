const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { findOrCreateUser, getUserById } = require('../db/database');
const log = require('../lib/logger');
const { extractLinkedInAvatarUrl } = require('../lib/oauth-profiles');

function configurePassport() {
  // Serialize: store only user ID in session
  passport.serializeUser((user, done) => {
    // Phase 6 §7.7: If requiresLinking, serialize linking metadata alongside id
    if (user.requiresLinking) {
      return done(null, {
        id: user.id,
        requiresLinking: true,
        pendingProvider: user.pendingProvider,
        pendingProfileId: user.pendingProfileId,
        pendingAvatarUrl: user.pendingAvatarUrl
      });
    }
    done(null, user.id);
  });

  // §10.8: deserializeUser runs on EVERY authenticated request.
  // getUserById is async in PG mode — must use async callback pattern.
  passport.deserializeUser(async (data, done) => {
    try {
      // Handle both old (number) and new (object with linking info) serialization
      const id = typeof data === 'object' ? data.id : data;
      const user = await getUserById(id);
      if (!user) return done(null, false);
      // Re-attach linking info if present
      if (typeof data === 'object' && data.requiresLinking) {
        user.requiresLinking = true;
        user.pendingProvider = data.pendingProvider;
        user.pendingProfileId = data.pendingProfileId;
        user.pendingAvatarUrl = data.pendingAvatarUrl;
      }
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // Phase 6 §7.7: Shared OAuth callback handler — all strategies use this.
  // If findOrCreateUser returns requiresLinking, the OAuth callback routes
  // will detect it and redirect to /auth/link-account for password verification.

  // ── Google OAuth Strategy ─────────────────────────────────────────────────
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      scope: ['profile', 'email'],
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateUser({
          provider: 'google',
          profileId: profile.id,
          email: profile.emails?.[0]?.value || '',
          name: profile.displayName || 'User',
          avatarUrl: profile.photos?.[0]?.value || null,
        });
        done(null, user);
      } catch (err) {
        done(err);
      }
    }));
    log.info('Google OAuth configured');
  } else {
    log.warn('Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
  }

  // ── GitHub OAuth Strategy (optional) ──────────────────────────────────────
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    try {
      const GitHubStrategy = require('passport-github2').Strategy;
      passport.use(new GitHubStrategy({
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK_URL || '/auth/github/callback',
        scope: ['user:email'],
      }, async (accessToken, refreshToken, profile, done) => {
        try {
          // Store null if no email is provided. Our DB and downstream flows
          // (like passport local strategy and password reset) require real emails.
          const email = profile.emails?.[0]?.value || null;
          const user = await findOrCreateUser({
            provider: 'github',
            profileId: profile.id,
            email,
            name: profile.displayName || profile.username || 'User',
            avatarUrl: profile.photos?.[0]?.value || null,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }));
      log.info('GitHub OAuth configured');
    } catch (e) {
      log.warn('GitHub OAuth package not found, skipping');
    }
  }

  // ── LinkedIn OAuth Strategy ────────────────────────────────────────────────
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    try {
      const OAuth2Strategy = require('passport-oauth2').Strategy;

      passport.use('linkedin', new OAuth2Strategy({
        authorizationURL: 'https://www.linkedin.com/oauth/v2/authorization',
        tokenURL: 'https://www.linkedin.com/oauth/v2/accessToken',
        clientID: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
        callbackURL: process.env.LINKEDIN_CALLBACK_URL || '/auth/linkedin/callback',
        scope: ['openid', 'profile', 'email'],
        state: true
      }, async (accessToken, refreshToken, rawProfile, done) => {
        try {
          // Fetch user info using OpenID Connect endpoint (LinkedIn API v2 is deprecated)
          const response = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          });
          
          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`LinkedIn profile fetch failed: ${response.status} ${errBody}`);
          }
          
          const profile = await response.json();
          
          const email = profile.email || `${profile.sub}@linkedin.local`;
          const name = profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || 'LinkedIn User';
          
          const avatarUrl = extractLinkedInAvatarUrl(profile);
          if (!avatarUrl) {
            log.info('LinkedIn OIDC profile returned no usable avatar', {
              subject: profile.sub || '',
              hasPicture: !!profile.picture,
              pictureType: typeof profile.picture,
            });
          }

          const user = await findOrCreateUser({
            provider: 'linkedin',
            profileId: profile.sub,
            email,
            name,
            avatarUrl: avatarUrl || null,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }));
      log.info('LinkedIn OAuth configured via OIDC');
    } catch (e) {
      log.warn('LinkedIn OAuth package not found or configured incorrectly', { error: e.message });
    }
  } else {
    log.warn('LinkedIn OAuth not configured (missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET)');
  }

  return passport;
}

module.exports = { configurePassport };
