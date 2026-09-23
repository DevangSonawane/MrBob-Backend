const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const otpStore = require('./otp.store');
const notificationsService = require('../notifications/notifications.service');
const { issueTokenPair, verifyRefreshToken } = require('./token.util');

const SALT_ROUNDS = 12;

const requestOtp = async (phone) => {
  const otp = otpStore.setOtp(phone);
  await notificationsService.sendOtp(phone, otp);
  return { sent: true };
};

const verifyOtpAndLogin = async (phone, otp, name) => {
  const isValid = otpStore.verifyOtp(phone, otp);
  if (!isValid) {
    throw ApiError.badRequest('Invalid or expired OTP');
  }

  let user = await prisma.user.findUnique({ where: { phone } });

  if (!user) {
    user = await prisma.user.create({
      data: { phone, name: name || 'New User', role: 'CUSTOMER' },
    });
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated');
  }

  const tokens = issueTokenPair(user);
  return { user, ...tokens };
};

const signupWithEmail = async ({ name, email, password, phone }) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  if (phone) {
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) {
      throw ApiError.conflict('An account with this phone number already exists');
    }
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { name, email, phone, passwordHash, role: 'CUSTOMER' },
  });

  const tokens = issueTokenPair(user);
  return { user, ...tokens };
};

const loginWithEmail = async (email, password) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated');
  }

  const tokens = issueTokenPair(user);
  return { user, ...tokens };
};

const refreshTokens = async (refreshToken) => {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account no longer active');
  }

  return issueTokenPair(user);
};

const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { professional: true },
  });
  if (!user) throw ApiError.notFound('User not found');
  return user;
};

module.exports = {
  requestOtp,
  verifyOtpAndLogin,
  signupWithEmail,
  loginWithEmail,
  refreshTokens,
  getProfile,
};
