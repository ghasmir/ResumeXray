const express = require('express');
const router = express.Router();
const billingService = require('../lib/billing-service');
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');
const { apiLimiter } = require('../config/security');
const log = require('../lib/logger');
const bodyParser = require('body-parser');

/**
 * ── GET /billing/packs — Return available credit packs ────────────────────
 */
router.get('/packs', (req, res) => {
  try {
    const packs = billingService.getAvailablePacks();
    res.json({ packs });
  } catch (err) {
    res.status(500).json({ error: 'Billing service unavailable' });
  }
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
    const checkout = await billingService.createCheckout(req.user.id, req.user.email, packId);
    res.json(checkout);
  } catch (err) {
    log.error('Checkout error', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
});

/**
 * ── POST /billing/webhook — Unified Webhook Handler ───────────────────────
 * This endpoint handles webhooks from the active provider.
 */
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  let provider;
  try {
    // Detect provider from headers or path if needed, otherwise use default
    const providerName = req.headers['stripe-signature'] ? 'stripe' : 
                         req.headers['x-signature'] ? 'lemonsqueezy' : null;
    provider = billingService.getProvider(providerName);
  } catch (err) {
    return res.status(500).send('Billing provider not configured');
  }

  let event;
  try {
    event = provider.verifyWebhook(req);
  } catch (err) {
    log.error(`Webhook verification failed for ${provider.name}`, { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const result = await provider.processWebhookEvent(event, db);
    
    if (!result) {
      return res.status(200).send('Event ignored');
    }

    const { userId, packId, credits, transactionId, eventId, eventType } = result;

    // Idempotency check
    const isProcessed = provider.name === 'stripe' 
      ? await db.isStripeEventProcessed(eventId)
      : await db.isLemonSqueezyEventProcessed(eventId);

    if (isProcessed) {
      log.info(`Duplicate ${provider.name} event skipped`, { eventId });
      return res.status(200).send('Already processed');
    }

    if (userId && credits > 0) {
      const packs = provider.CREDIT_PACKS;
      const pack = packs[packId];
      
      const added = await db.addCredits(
        userId,
        credits,
        'purchase',
        transactionId,
        `Purchased ${pack ? pack.name : packId} (${credits} credits) via ${provider.name}`
      );

      if (added) {
        // Record event as processed
        if (provider.name === 'stripe') {
          await db.recordStripeEvent(eventId, eventType);
        } else {
          await db.recordLemonSqueezyEvent(eventId, eventType);
        }
        log.info('Credit purchase completed', { userId, credits, packId, transactionId, provider: provider.name });
      }
    }

    res.status(200).send('Event received');
  } catch (err) {
    log.error('Webhook handler error', { error: err.message, provider: provider.name });
    res.status(500).send('Internal Server Error');
  }
});

/**
 * ── POST /billing/lemonsqueezy-webhook ────────────────────────────────────
 * Explicit endpoint for Lemon Squeezy webhooks.
 */
router.post('/lemonsqueezy-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  // We can just delegate to the main webhook handler or handle it explicitly
  // For now, let's ensure the billing service is set to lemonsqueezy for this request
  // or just handle it directly if we want to support multiple active webhooks.
  req.url = '/webhook'; // Internal redirect to the unified handler
  return router.handle(req, res);
});

module.exports = router;
