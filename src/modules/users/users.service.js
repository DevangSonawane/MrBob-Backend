const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const SALT_ROUNDS = 12;

const list = async ({ page, limit, role, cityId }) => {
  const where = { ...(role && { role }), ...(cityId && { cityId }) };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

const getById = async (id) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');
  return user;
};

const update = async (id, data) => {
  await getById(id);
  return prisma.user.update({ where: { id }, data });
};

const setActive = async (id, isActive) => {
  await getById(id);
  return prisma.user.update({ where: { id }, data: { isActive } });
};

// Invite-only account creation: only an existing admin can call this (see
// users.routes.js). If no password is given, a temp password is generated
// and returned once in the response for the admin to share out of band —
// it is never stored or logged in plaintext.
const create = async ({ name, email, role, password }) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const tempPassword = password || crypto.randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  const user = await prisma.user.create({ data: { name, email, role, passwordHash } });

  return { user, temporaryPassword: password ? undefined : tempPassword };
};

module.exports = { list, getById, update, setActive, create };
