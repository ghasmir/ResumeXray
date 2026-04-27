/**
 * Billing Service — Strategy Pattern Implementation
 * This service acts as a factory and registry for different payment providers.
 * It allows the application to switch between providers (e.g., Stripe, Lemon Squeezy)
 * seamlessly via environment variables.
 */

const log = require('./logger');

class BillingService {
  constructor() {
    this.providers = {};
    this.activeProviderName = (process.env.BILLING_PROVIDER || 'lemonsqueezy').toLowerCase();
  }

  /**
   * Register a payment provider strategy.
   * @param {string} name - The unique name of the provider (e.g., 'stripe').
   * @param {object} provider - The provider implementation.
   */
  registerProvider(name, provider) {
    this.providers[name.toLowerCase()] = provider;
    log.info(`Billing provider registered: ${name}`);
  }

  /**
   * Get the currently active payment provider.
   * @param {string} [name] - Optional name to override the active provider.
   * @returns {object} The active provider implementation.
   */
  getProvider(name) {
    const target = (name || this.activeProviderName).toLowerCase();
    const provider = this.providers[target];
    if (!provider) {
      throw new Error(`Billing provider "${target}" is not registered or configured.`);
    }
    return provider;
  }

  /**
   * Get all available credit packs from the active provider.
   */
  getAvailablePacks() {
    return this.getProvider().CREDIT_PACKS;
  }

  /**
   * Create a checkout session/URL using the active provider.
   */
  async createCheckout(userId, email, packId) {
    return await this.getProvider().createCheckout(userId, email, packId);
  }
}

// Singleton instance
const billingService = new BillingService();

// ── Register Providers ──────────────────────────────────────────────────────

// 1. Stripe Provider
try {
  const stripeConfig = require('../config/stripe');
  billingService.registerProvider('stripe', {
    name: 'stripe',
    CREDIT_PACKS: stripeConfig.CREDIT_PACKS,
    createCheckout: async (userId, email, packId) => {
      const session = await stripeConfig.createCheckoutSession(userId, email, packId);
      return { url: session.url };
    },
    verifyWebhook: (req) => {
      const stripe = stripeConfig.getStripe();
      const sig = req.headers['stripe-signature'];
      return stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    },
    processWebhookEvent: async (event, db) => {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        return {
          userId: parseInt(session.metadata.userId),
          packId: session.metadata.packId,
          credits: parseInt(session.metadata.credits),
          transactionId: session.id,
          customerReference: session.customer,
          eventId: event.id,
          eventType: event.type
        };
      }
      return null;
    }
  });
} catch (err) {
  log.warn('Stripe provider registration failed (likely missing config)', { error: err.message });
}

// 2. Lemon Squeezy Provider
try {
  const lsConfig = require('../config/lemonsqueezy');
  billingService.registerProvider('lemonsqueezy', {
    name: 'lemonsqueezy',
    CREDIT_PACKS: lsConfig.CREDIT_PACKS,
    createCheckout: async (userId, email, packId) => {
      const url = lsConfig.createCheckoutUrl(packId, userId, email);
      return { url };
    },
    verifyWebhook: (req) => {
      const signature = req.headers['x-signature'];
      const isValid = lsConfig.verifyWebhookSignature(req.body.toString(), signature);
      if (!isValid) throw new Error('Invalid Lemon Squeezy signature');
      return JSON.parse(req.body.toString());
    },
    processWebhookEvent: async (event, db) => {
      if (event.meta?.event_name === 'order_created') {
        const customData = event.meta?.custom_data || {};
        return {
          userId: parseInt(customData.user_id),
          packId: customData.pack_id,
          credits: parseInt(customData.credits),
          transactionId: event.data?.id,
          customerReference: event.data?.attributes?.customer_id,
          eventId: event.meta?.webhook_id,
          eventType: event.meta?.event_name
        };
      }
      return null;
    }
  });
} catch (err) {
  log.warn('Lemon Squeezy provider registration failed (likely missing config)', { error: err.message });
}

module.exports = billingService;
