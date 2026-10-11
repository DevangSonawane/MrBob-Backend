const Razorpay = require('razorpay');
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');

const isConfigured = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

const client = isConfigured
  ? new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET })
  : null;

const createOrder = async ({ amount, currency = 'INR', receipt, notes }) => {
  if (!client) {
    logger.warn('Razorpay is not configured — returning a dev/mock order');
    return { id: `order_dev_${Date.now()}`, amount, currency, receipt, status: 'created', dev: true };
  }
  return client.orders.create({ amount: Math.round(amount * 100), currency, receipt, notes });
};

const verifyWebhookSignature = (rawBody, signature) => {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
};

// Checkout hands the app (order id, payment id, signature); the signature is
// HMAC-SHA256 of "<order id>|<payment id>" with the key secret, which proves
// the payment really happened for this order.
const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  if (!env.RAZORPAY_KEY_SECRET || !signature) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const given = Buffer.from(String(signature));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
};

module.exports = { client, isConfigured, createOrder, verifyWebhookSignature, verifyPaymentSignature };
