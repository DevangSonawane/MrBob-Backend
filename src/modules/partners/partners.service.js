const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const include = { city: { select: { id: true, name: true } }, _count: { select: { bookings: true } } };

const toView = ({ _count, ...partner }) => ({ ...partner, bookings: _count.bookings });

// The city must be active, and no other partner there may have the same name.
const assertPlace = async ({ id, name, cityId }) => {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  if (!city || !city.isActive) throw ApiError.badRequest('Unknown or inactive city');
  const existing = await prisma.partner.findFirst({ where: { cityId, name: { equals: name, mode: 'insensitive' }, ...(id && { id: { not: id } }) } });
  if (existing) throw ApiError.conflict(`${existing.name} is already a partner in ${city.name}`);
};

const create = async ({ name: rawName, contact, ...data }) => {
  const name = rawName.trim();
  await assertPlace({ name, cityId: data.cityId });
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

const update = async (id, { name: rawName, contact, ...data }) => {
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) throw ApiError.notFound('Partner not found');
  const name = rawName?.trim() ?? partner.name;
  if (rawName !== undefined || data.cityId) await assertPlace({ id, name, cityId: data.cityId ?? partner.cityId });
  const changes = { ...data, name, ...(contact !== undefined && { contact: contact?.trim() || null }) };
  return toView(await prisma.partner.update({ where: { id }, data: changes, include }));
};

module.exports = { create, list, update };
