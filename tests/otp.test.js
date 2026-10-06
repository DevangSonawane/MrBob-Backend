const env = require('../src/config/env');
const otpStore = require('../src/modules/auth/otp.store');

describe('OTP generation', () => {
  const original = env.OTP_STATIC_CODE;
  afterEach(() => {
    env.OTP_STATIC_CODE = original;
  });

  it('uses the fixed code when OTP_STATIC_CODE is set', () => {
    env.OTP_STATIC_CODE = '1234';
    expect(otpStore.setOtp('+919700000001')).toBe('1234');
    expect(otpStore.verifyOtp('+919700000001', '4321')).toBe(false);
    expect(otpStore.verifyOtp('+919700000001', '1234')).toBe(true);
    // Single use, and only for a number that requested one.
    expect(otpStore.verifyOtp('+919700000001', '1234')).toBe(false);
    expect(otpStore.verifyOtp('+919700000002', '1234')).toBe(false);
  });

  it('generates a random 4-digit code otherwise', () => {
    env.OTP_STATIC_CODE = undefined;
    const codes = new Set(Array.from({ length: 20 }, (_unused, i) => otpStore.setOtp(`+91970000010${i}`)));
    codes.forEach((code) => expect(code).toMatch(/^\d{4}$/));
    expect(codes.size).toBeGreaterThan(1);
  });

  it('discards the code after too many wrong attempts', () => {
    env.OTP_STATIC_CODE = '1234';
    otpStore.setOtp('+919700000003');
    for (let attempt = 0; attempt < otpStore.MAX_ATTEMPTS; attempt += 1) {
      expect(otpStore.verifyOtp('+919700000003', '0000')).toBe(false);
    }
    // The right code no longer works; a new one has to be requested.
    expect(otpStore.verifyOtp('+919700000003', '1234')).toBe(false);
    otpStore.setOtp('+919700000003');
    expect(otpStore.verifyOtp('+919700000003', '1234')).toBe(true);
  });
});
