/**
 * Stripe Configuration — Credit Pack System
 * Replaces the old subscription-based model with one-time credit purchases.
 */

const Stripe = require('stripe');

let stripe;

function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Credit pack definitions.
 * Each pack is a one-time purchase that adds credits to the user's balance.
 */
const CREDIT_PACKS = {
  starter: {
    name: 'Starter Pack',
    credits: 5,
    price: 4.99,
    priceId: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter_5credits',
    label: '5 AI Exports',
    perCredit: '$1.00',
    description: 'Perfect for a single job application.',
  },
  pro: {
    name: 'Professional',
    credits: 15,
    price: 9.99,
    priceId: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_15credits',
    label: '15 AI Exports',
    perCredit: '$0.67',
    popular: true,
    description: 'The standard for active job seekers.',
  },
  hustler: {
    name: 'Hustler Pack',
    credits: 50,
    price: 19.99,
    priceId: process.env.STRIPE_POWER_PRICE_ID || 'price_power_50credits',
    label: '50 AI Exports',
    perCredit: '$0.40',
    description: 'Bulk credits for career pivoters.',
  },
};

/**
 * Credit costs per action.
 * v3: AI sandbox is FREE — credits only consumed on final export
 */
const CREDIT_COSTS = {
  scan: 0,       // Free — hooks the user (shows ATS score + knockout risks)
  ai_fix: 0,     // FREE — sandbox mode, user sees full value before paying
  export: 1,     // Per PDF/DOCX + Cover Letter download bundle
};

/**
 * Create a Stripe Checkout Session for a one-time credit pack purchase.
 */
async function createCheckoutSession(userId, email, packId) {
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  const pack = CREDIT_PACKS[packId];
  if (!pack) throw new Error(`Invalid credit pack: ${packId}`);

  const session = await s.checkout.sessions.create({
    mode: 'payment', // One-time, not subscription
    payment_method_types: ['card', 'link'],
    customer_email: email,
    line_items: [{ price: pack.priceId, quantity: 1 }],
    success_url: `${process.env.APP_URL}/dashboard?purchased=true&pack=${packId}`,
    cancel_url: `${process.env.APP_URL}/pricing?cancelled=true`,
    metadata: {
      userId: String(userId),
      packId,
      credits: String(pack.credits),
    },
  });

  return session;
}

module.exports = { getStripe, CREDIT_PACKS, CREDIT_COSTS, createCheckoutSession };
