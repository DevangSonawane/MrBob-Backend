const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const include = { city: { select: { id: true, name: true } }, _count: { select: { bookings: true } } };

const toView = ({ _count, ...partner }) => ({ ...partner, bookings: _count.bookings });

const create = async ({ name: rawName, contact, ...data }) => {
  const name = rawName.trim();
  const city = await prisma.city.findUnique({ where: { id: data.cityId } });
  if (!city || !city.isActive) throw ApiError.badRequest('Unknown or inactive city');
  const existing = await prisma.partner.findFirst({ where: { cityId: data.cityId, name: { equals: name, mode: 'insensitive' } } });
  if (existing) throw ApiError.conflict(`${existing.name} is already a partner in ${city.name}`);
  return toView(await prisma.partner.create({ data: { ...data, name, contact: contact?.trim() || null }, include }));
};

// A page of partners, plus how many of each type match the other filters (for the dashboard's tabs).
const list = async ({ page, limit, cityId, type, search }) => {
  const base = {
    ...(cityId && { cityId }),
    ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { contact: { contains: search, mode: 'insensitive' } }] }),
  };
  const where = { ...base, ...(type && { type }) };
  const [items, total, byType] = await Promise.all([
    prisma.partner.findMany({ where, include, ...toSkipTake({ page, limit }), orderBy: { createdAt: 'desc' } }),
    prisma.partner.count({ where }),
    prisma.partner.groupBy({ by: ['type'], where: base, _count: { _all: true } }),
  ]);
  const counts = { BUILDER: 0, RWA: 0 };
  byType.forEach((group) => {
    counts[group.type] = group._count._all;
  });
  return { ...paginatedResponse(items.map(toView), total, { page, limit }), counts };
};

module.exports = { create, list };
