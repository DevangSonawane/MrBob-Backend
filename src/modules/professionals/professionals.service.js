const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { isAdmin } = require('../../utils/roles');
const storage = require('../storage/storage.service');

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

// The professional row holds personal onboarding details (date of birth,
// address, emergency contact). Only admins and the professional themselves
// see those; any other signed-in user gets the public profile.
const getById = async (id, requester) => {
  const professional = await prisma.professional.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, phone: true } }, homeZone: true },
  });
  if (!professional) throw ApiError.notFound('Professional not found');
  if (isAdmin(requester.role) || professional.userId === requester.id) return professional;

  return {
    id: professional.id,
    categories: professional.categories,
    kycStatus: professional.kycStatus,
    rating: professional.rating,
    homeZone: professional.homeZone,
    photo: professional.onboardingStatus === 'APPROVED' && professional.profilePhotoKey ? `/professionals/${professional.id}/photo` : null,
    user: { id: professional.user.id, name: professional.user.name },
  };
};

// Customers see a professional's face only once they have been approved;
// before that the photo is visible through the onboarding endpoints only.
const getPhoto = async (id, requester) => {
  const professional = await prisma.professional.findUnique({ where: { id } });
  const canSee = professional && (professional.onboardingStatus === 'APPROVED' || isAdmin(requester.role) || professional.userId === requester.id);
  if (!canSee || !professional.profilePhotoKey) throw ApiError.notFound('Photo not found');
  return { stream: await storage.getStream(professional.profilePhotoKey), mimeType: professional.profilePhotoMime };
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

module.exports = { list, getById, getPhoto, getByUserId, update };
