const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const register = async (userId, { categories, homeZoneId }) => {
  const existing = await prisma.professional.findUnique({ where: { userId } });
  if (existing) throw ApiError.conflict('This user is already registered as a professional');

  return prisma.$transaction(async (tx) => {
    const professional = await tx.professional.create({
      data: { userId, categories, homeZoneId },
    });
    await tx.user.update({ where: { id: userId }, data: { role: 'PROFESSIONAL' } });
    return professional;
  });
};

const list = async ({ page, limit, kycStatus, category, zoneId }) => {
  const where = {
    ...(kycStatus && { kycStatus }),
    ...(zoneId && { homeZoneId: zoneId }),
    ...(category && { categories: { has: category } }),
  };
  const [items, total] = await Promise.all([
    prisma.professional.findMany({
      where,
      ...toSkipTake({ page, limit }),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.professional.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

const getById = async (id) => {
  const professional = await prisma.professional.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, phone: true } }, homeZone: true },
  });
  if (!professional) throw ApiError.notFound('Professional not found');
  return professional;
};

const getByUserId = async (userId) => {
  const professional = await prisma.professional.findUnique({ where: { userId } });
  if (!professional) throw ApiError.notFound('Professional profile not found for this user');
  return professional;
};

const update = async (userId, data) => {
  const professional = await getByUserId(userId);
  return prisma.professional.update({ where: { id: professional.id }, data });
};

const updateKycStatus = async (id, kycStatus) => {
  await getById(id);
  return prisma.professional.update({ where: { id }, data: { kycStatus } });
};

module.exports = { register, list, getById, getByUserId, update, updateKycStatus };
