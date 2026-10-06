// In-memory OTP store for local development only.
// Replace with Redis (key: `otp:<phone>`, value: hash + expiry) before
// running more than one backend instance — this Map is per-process and
// will not work behind a load balancer.

const env = require('../../config/env');
const logger = require('../../config/logger');

const OTP_TTL_MS = 5 * 60 * 1000;
const store = new Map();

if (env.OTP_STATIC_CODE) {
  logger.warn('OTP_STATIC_CODE is set — every login OTP is the same fixed code. Do not leave this on once SMS delivery exists.');
}

// With OTP_STATIC_CODE set (no SMS provider yet) the code is always that
// value; otherwise a fresh random one. Read at call time so it can be toggled in tests.
const generateOtp = () => env.OTP_STATIC_CODE || String(Math.floor(100000 + Math.random() * 900000));

const setOtp = (phone) => {
  const otp = generateOtp();
  store.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS });
  return otp;
};

const verifyOtp = (phone, otp) => {
  const entry = store.get(phone);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(phone);
    return false;
  }
  const isValid = entry.otp === otp;
  if (isValid) store.delete(phone);
  return isValid;
};

module.exports = { setOtp, verifyOtp };
