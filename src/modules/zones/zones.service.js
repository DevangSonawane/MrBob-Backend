const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

const sameName = (name) => ({ equals: name, mode: 'insensitive' });

const listCities = () => prisma.city.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });

const createCity = async (data) => {
  const name = data.name.trim();
  const existing = await prisma.city.findFirst({ where: { name: sameName(name) } });
  if (existing?.isActive) throw ApiError.conflict(`${existing.name} already exists`);
  if (existing) return prisma.city.update({ where: { id: existing.id }, data: { ...data, name, isActive: true } });
  return prisma.city.create({ data: { ...data, name } });
};

const listZones = (cityId) =>
  prisma.zone.findMany({
    where: { isActive: true, ...(cityId && { cityId }) },
    orderBy: { name: 'asc' },
  });

const createZone = async (data) => {
  const name = data.name.trim();
  const city = await prisma.city.findUnique({ where: { id: data.cityId } });
  if (!city || !city.isActive) throw ApiError.notFound('City not found');
  const existing = await prisma.zone.findFirst({ where: { cityId: data.cityId, name: sameName(name) } });
  if (existing?.isActive) throw ApiError.conflict(`${existing.name} already exists in ${city.name}`);
  if (existing) return prisma.zone.update({ where: { id: existing.id }, data: { name, isActive: true } });
  return prisma.zone.create({ data: { ...data, name } });
};

// Deleting coverage. People, addresses and bookings may still point at a city
// or zone, so the row is kept, switched off: it disappears from every list.
// Creating one with the same name later brings it back.
const removeZone = async (id) => {
  const zone = await prisma.zone.findUnique({ where: { id } });
  if (!zone) throw ApiError.notFound('Zone not found');
  await prisma.zone.update({ where: { id }, data: { isActive: false } });
  return { deleted: true, name: zone.name };
};

const removeCity = async (id) => {
  const city = await prisma.city.findUnique({ where: { id } });
  if (!city) throw ApiError.notFound('City not found');
  await prisma.$transaction([
    prisma.zone.updateMany({ where: { cityId: id }, data: { isActive: false } }),
    prisma.city.update({ where: { id }, data: { isActive: false } }),
  ]);
  return { deleted: true, name: city.name };
};

module.exports = { removeCity, removeZone, listCities, createCity, listZones, createZone };
