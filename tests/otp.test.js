const env = require('../src/config/env');
const otpStore = require('../src/modules/auth/otp.store');

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');

describe('Admin accounts and the static OTP', () => {
  const original = env.OTP_STATIC_CODE;
  const phone = `+9194${String(Date.now()).slice(-8)}`;
  let admin;

  beforeAll(async () => {
    admin = await prisma.user.create({ data: { name: 'OTP Test Admin', role: 'ADMIN', phone } });
  });
  afterAll(async () => {
    env.OTP_STATIC_CODE = original;
    await prisma.user.delete({ where: { id: admin.id } });
    await prisma.$disconnect();
  });

  it('cannot sign in by OTP while every number shares one code', async () => {
    env.OTP_STATIC_CODE = '1234';
    const requested = await request(app).post('/api/v1/auth/otp/request').send({ phone });
    expect(requested.status).toBe(403);
    const verified = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp: '1234' });
    expect(verified.status).toBe(403);
    expect(verified.body.data).toBeUndefined();
  });

  it('can again once OTPs are real', async () => {
    env.OTP_STATIC_CODE = undefined;
    const requested = await request(app).post('/api/v1/auth/otp/request').send({ phone });
    expect(requested.status).toBe(200);
  });
});

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
