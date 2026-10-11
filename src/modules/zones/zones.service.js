const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

const sameName = (name) => ({ equals: name, mode: 'insensitive' });

const listCities = () => prisma.city.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });

const createCity = async (data) => {
  const name = data.name.trim();
  const existing = await prisma.city.findFirst({ where: { name: sameName(name) } });
  if (existing) throw ApiError.conflict(`${existing.name} already exists`);
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
  if (!city) throw ApiError.notFound('City not found');
  const existing = await prisma.zone.findFirst({ where: { cityId: data.cityId, name: sameName(name) } });
  if (existing) throw ApiError.conflict(`${existing.name} already exists in ${city.name}`);
  return prisma.zone.create({ data: { ...data, name } });
};

module.exports = { listCities, createCity, listZones, createZone };
