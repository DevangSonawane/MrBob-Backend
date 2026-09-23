const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

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

module.exports = { list, getById, update, setActive };
