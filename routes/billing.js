const express = require('express');
const router = express.Router();
const { getStripe, createCheckoutSession, CREDIT_PACKS } = require('../config/stripe');
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');
const { apiLimiter } = require('../config/security');
const log = require('../lib/logger');

// Stripe requires raw body for webhook verification
const bodyParser = require('body-parser');

/**
 * ── GET /billing/packs — Return available credit packs ────────────────────
 */
router.get('/packs', (req, res) => {
  res.json({ packs: CREDIT_PACKS });
});

/**
 * ── GET /billing/credits — Get current user's credit balance & history ────
 */
router.get('/credits', apiLimiter, isAuthenticated, async (req, res) => {
  try {
    const balance = await db.getCreditBalance(req.user.id);
    const history = await db.getCreditHistory(req.user.id, 20);
    res.json({ balance, history });
  } catch (err) {
    log.error('Credits fetch error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch credit info' });
  }
});

/**
 * ── POST /billing/checkout — Purchase a credit pack ───────────────────────
 */
router.post('/checkout', apiLimiter, isAuthenticated, async (req, res) => {
  try {
    const { packId } = req.body;
    if (!CREDIT_PACKS[packId]) {
      return res.status(400).json({ error: 'Invalid credit pack selected' });
    }

    const session = await createCheckoutSession(req.user.id, req.user.email, packId);
    res.json({ url: session.url });
  } catch (err) {
    log.error('Checkout error', { error: err.message });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * ── POST /billing/webhook — Stripe Webhook (idempotent credit delivery) ───
 * 
 * Handles: checkout.session.completed
 * Idempotency: Uses stripe session ID as unique key in credit_transactions.
 * If the same event fires twice, addCredits() silently skips the duplicate.
 */
router.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(500).send('Stripe not configured');

    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      log.error('Webhook signature verification failed', { error: err.message });
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Phase 6 §8.2: Event-level idempotency — skip already-processed events
    if (await db.isStripeEventProcessed(event.id)) {
      log.info('Duplicate Stripe event skipped', { eventId: event.id });
      return res.status(200).send('Already processed');
    }

    // Phase 6 §8.3: Replay window — reject events older than 5 minutes
    // Stripe's `created` is Unix timestamp (seconds). Guards against replay attacks.
    const eventAgeSec = Math.floor(Date.now() / 1000) - event.created;
    if (eventAgeSec > 300) {
      log.warn('Stale Stripe event rejected', { eventId: event.id, ageSec: eventAgeSec });
      return res.status(200).send('Stale event');
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const userId = parseInt(session.metadata.userId);
          const packId = session.metadata.packId;
          const credits = parseInt(session.metadata.credits);

          if (userId && credits > 0) {
            const pack = CREDIT_PACKS[packId];
            // §8.4: await async DB calls (pg-database functions are async)
            const added = await db.addCredits(
              userId,
              credits,
              'purchase',
              session.id, // stripe_session_id for idempotency
              `Purchased ${pack ? pack.name : packId} (${credits} credits)`
            );

            if (added) {
              // Update stripe_customer_id if not set
              const user = await db.getUserById(userId);
              if (user && !user.stripe_customer_id && session.customer) {
                await db.setStripeCustomerId(userId, session.customer);
              }
              log.info('Credit purchase completed', { userId, credits, packId });
            }
          }
          break;
        }

        // No subscription events needed — credit system is one-time only
      }

      // Phase 6 §8.2: Record event as processed — prevents reprocessing on retry
      await db.recordStripeEvent(event.id, event.type);

      res.status(200).send('Event received');
    } catch (err) {
      log.error('Webhook handler error', { error: err.message, eventId: event.id });
      // §8.4: Return 200 even on handler errors — Stripe retries on non-2xx,
      // and we've already verified the signature. Failing silently is better
      // than causing infinite retries for a bad DB state.
      res.status(200).send('Accepted with error');
    }
  }
);

module.exports = router;
