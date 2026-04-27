const express = require('express');
const router = express.Router();
const { createCheckoutUrl, verifyWebhookSignature, CREDIT_PACKS } = require('../config/lemonsqueezy');
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');
const { apiLimiter } = require('../config/security');
const log = require('../lib/logger');

// Lemon Squeezy requires raw body for webhook verification
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
 * Generates a Lemon Squeezy hosted checkout URL and redirects the user.
 */
router.post('/checkout', apiLimiter, isAuthenticated, async (req, res) => {
  try {
    const { packId } = req.body;
    if (!CREDIT_PACKS[packId]) {
      return res.status(400).json({ error: 'Invalid credit pack selected' });
    }

    const checkoutUrl = createCheckoutUrl(req.user.id, req.user.email, packId);
    res.json({ url: checkoutUrl });
  } catch (err) {
    log.error('Checkout error', { error: err.message });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * ── POST /billing/lemonsqueezy-webhook — Lemon Squeezy Webhook ────────────
 *
 * Handles: order_created events (successful payment)
 * Idempotency: Uses Lemon Squeezy order ID as unique key in credit_transactions.
 * If the same event fires twice, addCredits() silently skips the duplicate.
 *
 * Webhook payload structure (simplified):
 * {
 *   meta: {
 *     event_name: "order_created",
 *     webhook_id: "...",
 *     custom_data: { user_id, pack_id, credits }
 *   },
 *   data: {
 *     type: "orders",
 *     id: "order_123",
 *     attributes: {
 *       order_number: 1,
 *       customer_email: "user@example.com",
 *       total_formatted: "$9.99",
 *       status: "completed"
 *     }
 *   }
 * }
 */
router.post('/lemonsqueezy-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-signature'];
  const body = req.body;

  // Verify webhook signature
  if (!verifyWebhookSignature(body.toString(), signature)) {
    log.warn('Invalid Lemon Squeezy webhook signature');
    return res.status(401).send('Unauthorized');
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch (err) {
    log.error('Failed to parse webhook payload', { error: err.message });
    return res.status(400).send('Invalid JSON');
  }

  // Phase 6 §8.2: Event-level idempotency — skip already-processed events
  const eventId = event.meta?.webhook_id;
  if (eventId && await db.isLemonSqueezyEventProcessed(eventId)) {
    log.info('Duplicate Lemon Squeezy event skipped', { eventId });
    return res.status(200).send('Already processed');
  }

  try {
    const eventName = event.meta?.event_name;

    if (eventName === 'order_created') {
      const orderId = event.data?.id;
      const customData = event.meta?.custom_data || {};
      const userId = parseInt(customData.user_id);
      const packId = customData.pack_id;
      const credits = parseInt(customData.credits);

      if (userId && credits > 0) {
        const pack = CREDIT_PACKS[packId];
        // §8.4: await async DB calls
        const added = await db.addCredits(
          userId,
          credits,
          'purchase',
          orderId, // lemon_squeezy_order_id for idempotency
          `Purchased ${pack ? pack.name : packId} (${credits} credits)`
        );

        if (added) {
          log.info('Credit purchase completed', { userId, credits, packId, orderId });
        }
      }
    }

    // Phase 6 §8.2: Record event as processed — prevents reprocessing on retry
    if (eventId) {
      await db.recordLemonSqueezyEvent(eventId, eventName);
    }

    res.status(200).send('Event received');
  } catch (err) {
    log.error('Webhook handler error', { error: err.message, eventId: event.meta?.webhook_id });
    // §8.4: Return 500 on DB errors so Lemon Squeezy retries — a failed credit delivery
    // should be reprocessed. Only return 200 for verified-but-already-handled events.
    res.status(500).send('Webhook handler error — Lemon Squeezy should retry');
  }
});

module.exports = router;
