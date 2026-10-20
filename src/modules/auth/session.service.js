const crypto = require('crypto');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { signAccessToken, verifyRefreshToken } = require('./token.util');

// Sign-in sessions. The access token is a short-lived JWT; the refresh token
// is "<session id>.<secret>", backed by a row here, so it can be extended
// (each refresh pushes the expiry out again — a device in regular use stays
// signed in) and revoked (logout, deactivation, account deletion).

const UNITS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
// '30d' / '12h' / '15m' -> milliseconds.
const toMs = (value) => {
  const match = String(value).match(/^(\d+)\s*([smhd])$/);
  return match ? Number(match[1]) * UNITS[match[2]] : 30 * UNITS.d;
};
const refreshLifetimeMs = () => toMs(env.JWT_REFRESH_EXPIRES_IN);
const hash = (secret) => crypto.createHash('sha256').update(secret).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What every sign-in returns. accessTokenExpiresIn is in seconds, so apps can
// refresh a little before it runs out instead of waiting for a 401.
const tokensFor = (user, sessionId, refreshToken) => ({
  accessToken: signAccessToken(user, sessionId),
  refreshToken,
  accessTokenExpiresIn: Math.round(toMs(env.JWT_ACCESS_EXPIRES_IN) / 1000),
});

const start = async (user, { userAgent } = {}) => {
  const secret = crypto.randomBytes(32).toString('base64url');
  const session = await prisma.authSession.create({
    data: { userId: user.id, tokenHash: hash(secret), userAgent: userAgent?.slice(0, 300) ?? null, expiresAt: new Date(Date.now() + refreshLifetimeMs()) },
  });
  return tokensFor(user, session.id, `${session.id}.${secret}`);
};

const expired = (message) => new ApiError(401, message, { code: 'SESSION_EXPIRED' });

const usableUser = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || !user.isActive) throw expired('Account no longer active. Sign in again.');
  return user;
};

// A new access token for a refresh token. The refresh token stays the same
// (no rotation, so two requests refreshing at once both succeed) and its
// expiry slides forward.
const refresh = async (refreshToken, { userAgent } = {}) => {
  const [sessionId, secret] = String(refreshToken).split('.');
  if (UUID.test(sessionId) && secret && !String(refreshToken).includes(' ')) {
    const session = await prisma.authSession.findUnique({ where: { id: sessionId } });
    const ok = session && !session.revokedAt && session.expiresAt > new Date() && crypto.timingSafeEqual(Buffer.from(hash(secret)), Buffer.from(session.tokenHash));
    if (!ok) throw expired('Session expired. Sign in again.');
    const user = await usableUser(session.userId);
    await prisma.authSession.update({ where: { id: sessionId }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + refreshLifetimeMs()) } });
    return tokensFor(user, sessionId, refreshToken);
  }

  // A refresh token from before sessions existed (a JWT): accept it once and
  // move the device onto a session.
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw expired('Session expired. Sign in again.');
  }
  return start(await usableUser(payload.sub), { userAgent });
};

// Signs this device out. Unknown or already-revoked tokens are fine.
const end = async (refreshToken) => {
  const [sessionId] = String(refreshToken ?? '').split('.');
  if (UUID.test(sessionId)) await prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  return { signedOut: true };
};

// Signs the user out everywhere (deactivated or deleted account).
const endAll = (userId, db = prisma) => db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

module.exports = { start, refresh, end, endAll };
