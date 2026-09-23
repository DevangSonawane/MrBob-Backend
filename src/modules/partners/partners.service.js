const prisma = require('../../config/prisma');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const create = (data) => prisma.partner.create({ data });

const list = async ({ page, limit, cityId, type }) => {
  const where = { ...(cityId && { cityId }), ...(type && { type }) };
  const [items, total] = await Promise.all([
    prisma.partner.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { createdAt: 'desc' } }),
    prisma.partner.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

module.exports = { create, list };
