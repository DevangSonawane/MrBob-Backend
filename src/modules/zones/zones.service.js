const prisma = require('../../config/prisma');

const listCities = () => prisma.city.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });

const createCity = (data) => prisma.city.create({ data });

const listZones = (cityId) =>
  prisma.zone.findMany({
    where: { isActive: true, ...(cityId && { cityId }) },
    orderBy: { name: 'asc' },
  });

const createZone = (data) => prisma.zone.create({ data });

module.exports = { listCities, createCity, listZones, createZone };
