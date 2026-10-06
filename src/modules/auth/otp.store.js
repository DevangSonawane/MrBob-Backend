// In-memory OTP store for local development only.
// Replace with Redis (key: `otp:<phone>`, value: hash + expiry) before
// running more than one backend instance — this Map is per-process and
// will not work behind a load balancer.

const env = require('../../config/env');
const logger = require('../../config/logger');

const OTP_LENGTH = 4;
const OTP_TTL_MS = 5 * 60 * 1000;
// A 4-digit code has only 10,000 possibilities, so guesses are capped: after
// this many wrong tries the code is discarded and a new one must be requested.
const MAX_ATTEMPTS = 5;
const store = new Map();

if (env.OTP_STATIC_CODE) {
  logger.warn('OTP_STATIC_CODE is set — every login OTP is the same fixed code. Do not leave this on once SMS delivery exists.');
}

// With OTP_STATIC_CODE set (no SMS provider yet) the code is always that
// value; otherwise a fresh random one. Read at call time so it can be toggled in tests.
const generateOtp = () => env.OTP_STATIC_CODE || String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

const setOtp = (phone) => {
  const otp = generateOtp();
  store.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
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
  if (isValid) {
    store.delete(phone);
  } else {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) store.delete(phone);
  }
  return isValid;
};

module.exports = { setOtp, verifyOtp, OTP_LENGTH, MAX_ATTEMPTS };
