/**
 * Lemon Squeezy Configuration — Credit Pack System
 * Replaces Stripe with Lemon Squeezy hosted checkout for one-time credit purchases.
 */

const crypto = require('crypto');

/**
 * Credit pack definitions.
 * Each pack is a one-time purchase that adds credits to the user's balance.
 * Links internal pack IDs to Lemon Squeezy product/variant IDs.
 */
const CREDIT_PACKS = {
  starter: {
    name: 'Starter Pack',
    credits: 5,
    price: 4.99,
    variantId: process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID || 'variant_starter_5credits',
    label: '5 AI Exports',
    perCredit: '$1.00',
    description: 'Perfect for a single job application.',
  },
  pro: {
    name: 'Professional',
    credits: 15,
    price: 9.99,
    variantId: process.env.LEMON_SQUEEZY_PRO_VARIANT_ID || 'variant_pro_15credits',
    label: '15 AI Exports',
    perCredit: '$0.67',
    popular: true,
    description: 'The standard for active job seekers.',
  },
  hustler: {
    name: 'Hustler Pack',
    credits: 50,
    price: 19.99,
    variantId: process.env.LEMON_SQUEEZY_HUSTLER_VARIANT_ID || 'variant_hustler_50credits',
    label: '50 AI Exports',
    perCredit: '$0.40',
    description: 'Bulk credits for career pivoters.',
  },
};

/**
 * Create a Lemon Squeezy hosted checkout URL for a credit pack purchase.
 * Returns the checkout URL to which the user should be redirected.
 */
function createCheckoutUrl(packId, userId, email) {
  const pack = CREDIT_PACKS[packId];
  if (!pack) throw new Error(`Invalid credit pack: ${packId}`);

  const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
  if (!storeId) throw new Error('Lemon Squeezy store ID not configured');

  const successUrl = `${process.env.APP_URL}/dashboard?purchased=true&pack=${packId}`;
  const cancelUrl = `${process.env.APP_URL}/pricing?cancelled=true`;

  // Lemon Squeezy hosted checkout URL format:
  // https://checkout.lemonsqueezy.com/checkout/buy/{variant_id}?checkout[email]={email}&checkout[custom][user_id]={userId}&checkout[success_url]={successUrl}&checkout[cancel_url]={cancelUrl}
  const params = new URLSearchParams({
    'checkout[email]': email,
    'checkout[custom][user_id]': String(userId),
    'checkout[custom][pack_id]': packId,
    'checkout[custom][credits]': String(pack.credits),
    'checkout[success_url]': successUrl,
    'checkout[cancel_url]': cancelUrl,
  });

  const checkoutUrl = `https://checkout.lemonsqueezy.com/checkout/buy/${pack.variantId}?${params.toString()}`;
  return checkoutUrl;
}

/**
 * Verify a Lemon Squeezy webhook signature.
 * Returns true if the signature is valid, false otherwise.
 */
function verifyWebhookSignature(payload, signature) {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) return false;

  // Lemon Squeezy uses HMAC-SHA256 for webhook signatures
  const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return hash === signature;
}

module.exports = {
  CREDIT_PACKS,
  createCheckoutUrl,
  verifyWebhookSignature,
};
