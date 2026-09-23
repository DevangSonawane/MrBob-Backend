// In-memory OTP store for local development only.
// Replace with Redis (key: `otp:<phone>`, value: hash + expiry) before
// running more than one backend instance — this Map is per-process and
// will not work behind a load balancer.

const OTP_TTL_MS = 5 * 60 * 1000;
const store = new Map();

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

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
