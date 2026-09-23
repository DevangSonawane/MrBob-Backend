const logger = require('../../config/logger');
const env = require('../../config/env');

// Stub senders. Swap the body of each function for the real WhatsApp
// Business API / Firebase Cloud Messaging call — signatures are kept
// stable so callers elsewhere in the app don't need to change.

const sendWhatsAppMessage = async (phone, message) => {
  if (!env.WHATSAPP_API_TOKEN) {
    logger.info({ phone, message }, '[dev] WhatsApp message (not sent, no API token configured)');
    return { queued: false, dev: true };
  }
  // TODO: call WhatsApp Business API using env.WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID
  return { queued: true };
};

const sendPushNotification = async (userId, { title, body, data }) => {
  logger.info({ userId, title, body, data }, '[dev] Push notification (not sent, FCM not configured)');
  // TODO: call Firebase Cloud Messaging
  return { queued: false, dev: true };
};

const sendOtp = async (phone, otp) => sendWhatsAppMessage(phone, `Your Home Services verification code is ${otp}. It expires in 5 minutes.`);

module.exports = { sendWhatsAppMessage, sendPushNotification, sendOtp };
