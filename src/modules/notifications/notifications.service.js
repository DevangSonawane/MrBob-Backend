const logger = require('../../config/logger');
const env = require('../../config/env');
const fcm = require('./fcm.client');
const devices = require('./devices.service');

// Outgoing messages. Push notifications go through Firebase Cloud Messaging
// to every device the user is signed in on (see devices.service.js); without
// the FIREBASE_* keys they are written to the log instead. WhatsApp is still
// a stub. Signatures are kept stable so callers elsewhere don't change.

const sendWhatsAppMessage = async (phone, message) => {
  if (!env.WHATSAPP_API_TOKEN) {
    logger.info({ phone, message }, '[dev] WhatsApp message (not sent, no API token configured)');
    return { queued: false, dev: true };
  }
  // TODO: call WhatsApp Business API using env.WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID
  return { queued: true };
};

// Resolves to how many devices got it; never throws for a delivery problem,
// so a notification can't break the action that triggered it.
const sendPushNotification = async (userId, { title, body, data }) => {
  const tokens = await devices.liveTokens(userId);
  if (!fcm.isConfigured()) {
    logger.info({ userId, title, body, data, devices: tokens.length }, '[dev] Push notification (not sent, FCM not configured)');
    return { sent: 0, devices: tokens.length, dev: true };
  }
  if (!tokens.length) return { sent: 0, devices: 0 };

  const results = await Promise.all(tokens.map((token) => fcm.send(token, { title, body, data }).catch((err) => ({ ok: false, error: err.message }))));
  const dead = tokens.filter((_token, index) => results[index].deadToken);
  await devices.forgetTokens(dead);
  const failed = results.filter((result) => !result.ok && !result.deadToken);
  if (failed.length) logger.warn({ userId, title, errors: failed.map((result) => result.error) }, 'Some push notifications were not delivered');
  return { sent: results.filter((result) => result.ok).length, devices: tokens.length, removed: dead.length, failed: failed.length };
};

const sendOtp = async (phone, otp) => sendWhatsAppMessage(phone, `Your Home Services verification code is ${otp}. It expires in 5 minutes.`);

module.exports = { sendWhatsAppMessage, sendPushNotification, sendOtp };
