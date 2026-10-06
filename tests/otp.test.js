const env = require('../src/config/env');
const otpStore = require('../src/modules/auth/otp.store');

describe('OTP generation', () => {
  const original = env.OTP_STATIC_CODE;
  afterEach(() => {
    env.OTP_STATIC_CODE = original;
  });

  it('uses the fixed code when OTP_STATIC_CODE is set', () => {
    env.OTP_STATIC_CODE = '123456';
    expect(otpStore.setOtp('+919700000001')).toBe('123456');
    expect(otpStore.verifyOtp('+919700000001', '654321')).toBe(false);
    expect(otpStore.verifyOtp('+919700000001', '123456')).toBe(true);
    // Single use, and only for a number that requested one.
    expect(otpStore.verifyOtp('+919700000001', '123456')).toBe(false);
    expect(otpStore.verifyOtp('+919700000002', '123456')).toBe(false);
  });

  it('generates a random 6-digit code otherwise', () => {
    env.OTP_STATIC_CODE = undefined;
    const codes = new Set(Array.from({ length: 20 }, (_unused, i) => otpStore.setOtp(`+91970000010${i}`)));
    codes.forEach((code) => expect(code).toMatch(/^\d{6}$/));
    expect(codes.size).toBeGreaterThan(1);
  });
});
