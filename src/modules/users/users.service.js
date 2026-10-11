const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { isSuperAdmin } = require('../../utils/roles');
const { dateRange, personSearch } = require('../../utils/queryFilters');
const { extensionFor } = require('../../middlewares/upload');
const storage = require('../storage/storage.service');
const notifications = require('../notifications/notifications.service');
const otpStore = require('../auth/otp.store');
const addresses = require('./addresses.service');
const { deleteAccount } = require('./accountDeletion.service');

const SALT_ROUNDS = 12;

// What list and detail responses add to the bare user row.
const userInclude = {
  city: { select: { id: true, name: true } },
  professional: { select: { id: true, onboardingStatus: true, kycStatus: true, rating: true } },
};

// Deleted accounts are kept as anonymised rows; to every lookup below they
// simply do not exist.
const findActive = async (id, include) => {
  const user = await prisma.user.findUnique({ where: { id }, ...(include && { include }) });
  if (!user || user.deletedAt) throw ApiError.notFound('User not found');
  return user;
};

const toDate = (value) => (value ? new Date(`${value}T00:00:00.000Z`) : value);

const assertUnique = async (field, value, exceptId, message) => {
  if (!value) return;
  const taken = await prisma.user.findUnique({ where: { [field]: value } });
  if (taken && taken.id !== exceptId) throw ApiError.conflict(message);
};

// ---------------------------------------------------------------------------
// The signed-in user's own account
// ---------------------------------------------------------------------------

const getMe = async (userId) => {
  const user = await findActive(userId, userInclude);
  return { ...user, addresses: await addresses.list(userId) };
};

const updateMe = async (userId, { dateOfBirth, ...data }) => {
  await findActive(userId);
  await assertUnique('email', data.email, userId, 'This email is already linked to another account');
  await prisma.user.update({ where: { id: userId }, data: { ...data, ...(dateOfBirth !== undefined && { dateOfBirth: toDate(dateOfBirth) }) } });
  return getMe(userId);
};

const setPhoto = async (userId, files = {}) => {
  const user = await findActive(userId);
  const photo = files.photo?.[0];
  if (!photo) throw ApiError.badRequest('Upload an image as "photo"');

  const key = `users/${userId}/photo-${crypto.randomUUID()}.${extensionFor(photo.mimetype)}`;
  await storage.put(key, photo.buffer, photo.mimetype);
  await prisma.user.update({ where: { id: userId }, data: { profilePhotoKey: key, profilePhotoMime: photo.mimetype } });
  if (user.profilePhotoKey) await storage.remove(user.profilePhotoKey);
  return getMe(userId);
};

const removePhoto = async (userId) => {
  const user = await findActive(userId);
  if (user.profilePhotoKey) {
    await prisma.user.update({ where: { id: userId }, data: { profilePhotoKey: null, profilePhotoMime: null } });
    await storage.remove(user.profilePhotoKey);
  }
  return getMe(userId);
};

const openPhoto = async (id) => {
  const user = await findActive(id);
  if (!user.profilePhotoKey) throw ApiError.notFound('No profile photo');
  return { stream: await storage.getStream(user.profilePhotoKey), mimeType: user.profilePhotoMime };
};

// Changing the login phone number is confirmed with an OTP sent to the NEW
// number, so an account can only move to a phone its owner really holds.
const phoneChangeKey = (userId, phone) => `phone-change:${userId}:${phone}`;

const requestPhoneChange = async (userId, phone) => {
  const user = await findActive(userId);
  if (user.phone === phone) throw ApiError.badRequest('This is already your phone number');
  await assertUnique('phone', phone, userId, 'This phone number is already linked to another account');

  const otp = otpStore.setOtp(phoneChangeKey(userId, phone));
  await notifications.sendOtp(phone, otp);
  return { sent: true, expiresInSeconds: 300 };
};

const confirmPhoneChange = async (userId, phone, otp) => {
  await findActive(userId);
  if (!otpStore.verifyOtp(phoneChangeKey(userId, phone), otp)) throw ApiError.badRequest('Invalid or expired OTP');
  await assertUnique('phone', phone, userId, 'This phone number is already linked to another account');
  await prisma.user.update({ where: { id: userId }, data: { phone } });
  return getMe(userId);
};

const deleteMe = async (userId) => {
  const user = await findActive(userId);
  // Staff accounts are removed by a super admin, so there is always a record of who did it.
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    throw ApiError.forbidden('Admin accounts can only be deleted by a super admin');
  }
  return deleteAccount(userId);
};

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

const list = async ({ page, limit, role, gender, cityId, isActive, isOnboarded, vendorStatus, deleted, search, createdFrom, createdTo, sortBy, sortOrder }) => {
  const createdAt = dateRange(createdFrom, createdTo);
  const where = {
    // Deleted accounts are hidden unless asked for.
    deletedAt: deleted ? { not: null } : null,
    ...(role && { role: { in: role } }),
    ...(gender && { gender }),
    ...(cityId && { cityId }),
    ...(isActive !== undefined && { isActive }),
    ...(isOnboarded !== undefined && { isOnboarded }),
    ...(vendorStatus && { professional: { onboardingStatus: { in: vendorStatus } } }),
    ...(createdAt && { createdAt }),
    ...(search && personSearch(search)),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { [sortBy]: sortOrder }, include: userInclude }),
    prisma.user.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

// The user with their city, addresses, vendor status and how much they have
// used the platform. Unlike the other lookups this one still returns a
// deleted account (what is left of it), so admins can see that it was deleted.
const getDetail = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { ...userInclude, _count: { select: { bookings: true, reviews: true, amcSubscriptions: true } } },
  });
  if (!user) throw ApiError.notFound('User not found');
  const { _count, ...rest } = user;
  return { ...rest, addresses: await addresses.list(id), counts: _count };
};

const NEW_USER_WINDOW_DAYS = 30;

const getSummary = async () => {
  const since = new Date(Date.now() - NEW_USER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const existing = { deletedAt: null };
  const [byRoleRows, active, onboarded, recent, deleted] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], where: existing, _count: { _all: true } }),
    prisma.user.count({ where: { ...existing, isActive: true } }),
    prisma.user.count({ where: { ...existing, isOnboarded: true } }),
    prisma.user.count({ where: { ...existing, createdAt: { gte: since } } }),
    prisma.user.count({ where: { deletedAt: { not: null } } }),
  ]);
  const byRole = { CUSTOMER: 0, PROFESSIONAL: 0, ADMIN: 0, SUPER_ADMIN: 0 };
  byRoleRows.forEach((row) => {
    byRole[row.role] = row._count._all;
  });
  const total = Object.values(byRole).reduce((sum, count) => sum + count, 0);
  return { total, byRole, active, inactive: total - active, onboarded, newInLast30Days: recent, deleted };
};

const setActive = async (id, isActive, actor) => {
  const user = await findActive(id);
  if (isSuperAdmin(user.role) && !isSuperAdmin(actor.role)) {
    throw ApiError.forbidden('Only a super admin can activate or deactivate a super admin');
  }
  return prisma.user.update({ where: { id }, data: { isActive } });
};

// Super admin edit of any account. Role changes are limited to moving
// between customer and staff roles: PROFESSIONAL is granted and removed
// only by the vendor onboarding flow, which owns everything that goes with it.
const adminUpdate = async (id, { dateOfBirth, ...data }, actor) => {
  const user = await findActive(id);

  if (data.role && data.role !== user.role) {
    if (id === actor.id) throw ApiError.badRequest('You cannot change your own role');
    if (user.role === 'PROFESSIONAL' || data.role === 'PROFESSIONAL') {
      throw ApiError.badRequest('The PROFESSIONAL role is managed through vendor onboarding and cannot be set here');
    }
  }
  if (data.isActive === false && id === actor.id) throw ApiError.badRequest('You cannot deactivate your own account');

  await assertUnique('email', data.email, id, 'This email is already linked to another account');
  await assertUnique('phone', data.phone, id, 'This phone number is already linked to another account');

  await prisma.user.update({ where: { id }, data: { ...data, ...(dateOfBirth !== undefined && { dateOfBirth: toDate(dateOfBirth) }) } });
  return getDetail(id);
};

const adminDelete = async (id, actor) => {
  if (id === actor.id) throw ApiError.badRequest('You cannot delete your own account');
  return deleteAccount(id);
};

// Invite-only account creation: only an existing admin can call this (see
// users.routes.js). If no password is given, a temp password is generated
// and returned once in the response for the admin to share out of band —
// it is never stored or logged in plaintext.
const create = async ({ name, email, role, password }, actor) => {
  if (isSuperAdmin(role) && !isSuperAdmin(actor.role)) {
    throw ApiError.forbidden('Only a super admin can create another super admin');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const tempPassword = password || crypto.randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  const user = await prisma.user.create({ data: { name, email, role, passwordHash } });

  return { user, temporaryPassword: password ? undefined : tempPassword };
};

module.exports = {
  getMe,
  updateMe,
  setPhoto,
  removePhoto,
  openPhoto,
  requestPhoneChange,
  confirmPhoneChange,
  deleteMe,
  list,
  getDetail,
  getSummary,
  setActive,
  adminUpdate,
  adminDelete,
  create,
};
