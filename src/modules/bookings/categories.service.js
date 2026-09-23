const prisma = require('../../config/prisma');

const list = () => prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });

const create = (data) => prisma.serviceCategory.create({ data });

module.exports = { list, create };
