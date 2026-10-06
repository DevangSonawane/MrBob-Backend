const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { isSuperAdmin } = require('../../utils/roles');
const { dateRange, personSearch } = require('../../utils/queryFilters');

const SALT_ROUNDS = 12;

// What list and detail responses add to the bare user row.
const userInclude = {
  city: { select: { id: true, name: true } },
  professional: { select: { id: true, onboardingStatus: true, kycStatus: true, rating: true } },
};

const list = async ({ page, limit, role, cityId, isActive, isOnboarded, vendorStatus, search, createdFrom, createdTo, sortBy, sortOrder }) => {
  const createdAt = dateRange(createdFrom, createdTo);
  const where = {
    ...(role && { role: { in: role } }),
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

const getById = async (id) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');
  return user;
};

// The user with their city, vendor status and how much they have used the platform.
const getDetail = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { ...userInclude, _count: { select: { bookings: true, reviews: true, amcSubscriptions: true } } },
  });
  if (!user) throw ApiError.notFound('User not found');
  const { _count, ...rest } = user;
  return { ...rest, counts: _count };
};

const NEW_USER_WINDOW_DAYS = 30;

const getSummary = async () => {
  const since = new Date(Date.now() - NEW_USER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [byRoleRows, active, onboarded, recent] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isOnboarded: true } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
  ]);
  const byRole = { CUSTOMER: 0, PROFESSIONAL: 0, ADMIN: 0, SUPER_ADMIN: 0 };
  byRoleRows.forEach((row) => {
    byRole[row.role] = row._count._all;
  });
  const total = Object.values(byRole).reduce((sum, count) => sum + count, 0);
  return { total, byRole, active, inactive: total - active, onboarded, newInLast30Days: recent };
};

const update = async (id, data) => {
  await getById(id);
  return prisma.user.update({ where: { id }, data });
};

const setActive = async (id, isActive, actor) => {
  const user = await getById(id);
  if (isSuperAdmin(user.role) && !isSuperAdmin(actor.role)) {
    throw ApiError.forbidden('Only a super admin can activate or deactivate a super admin');
  }
  return prisma.user.update({ where: { id }, data: { isActive } });
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

module.exports = { list, getById, getDetail, getSummary, update, setActive, create };
