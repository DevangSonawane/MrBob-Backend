const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

// The devices a user gets push notifications on. The apps register their FCM
// token after signing in and again on every start (tokens change). A device
// belongs to the sign-in session it registered from, so signing out — or the
// account being deactivated or deleted — removes it.

const MAX_DEVICES = 10;

const toView = ({ id, platform, createdAt, lastSeenAt }) => ({ id, platform, registeredAt: createdAt, lastSeenAt });

// The same token registered again (app restart, or another account signed in
// on this phone) moves to this user and session.
const register = async (user, { token, platform }) => {
  const device = await prisma.pushDevice.upsert({
    where: { token },
    create: { token, platform, userId: user.id, sessionId: user.sessionId ?? null },
    update: { platform, userId: user.id, sessionId: user.sessionId ?? null, lastSeenAt: new Date() },
  });
  // Keep the most recently seen devices only.
  const stale = await prisma.pushDevice.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' }, skip: MAX_DEVICES, select: { id: true } });
  if (stale.length) await prisma.pushDevice.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  return toView(device);
};

// Turning notifications off on this device (or signing out without a refresh token to hand).
const unregister = async (user, token) => {
  const { count } = await prisma.pushDevice.deleteMany({ where: { token, userId: user.id } });
  if (!count) throw ApiError.notFound('This device is not registered');
  return { removed: true };
};

// Where a notification for this user goes: devices whose session is still signed in.
const liveTokens = async (userId) => {
  const devices = await prisma.pushDevice.findMany({
    where: { userId, OR: [{ sessionId: null }, { session: { revokedAt: null, expiresAt: { gt: new Date() } } }] },
    select: { token: true },
  });
  return devices.map((device) => device.token);
};

const forgetTokens = (tokens) => (tokens.length ? prisma.pushDevice.deleteMany({ where: { token: { in: tokens } } }) : null);

// Called when sessions end (logout, deactivation, deletion).
const removeForSession = (sessionId, db = prisma) => db.pushDevice.deleteMany({ where: { sessionId } });
const removeForUser = (userId, db = prisma) => db.pushDevice.deleteMany({ where: { userId } });

module.exports = { register, unregister, liveTokens, forgetTokens, removeForSession, removeForUser, MAX_DEVICES };
