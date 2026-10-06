const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

const getStatus = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { professional: true } });
  if (!user) throw ApiError.notFound('User not found');

  return {
    isOnboarded: user.isOnboarded,
    role: user.role,
    hasProfessionalProfile: Boolean(user.professional),
    // Where a vendor is in /vendor-onboarding; null for accounts that never started it.
    vendorOnboardingStatus: user.professional?.onboardingStatus ?? null,
  };
};

const assertPhoneAvailable = async (userId, phone) => {
  if (!phone) return;
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing && existing.id !== userId) {
    throw ApiError.conflict('This phone number is already linked to another account');
  }
};

const assertCityExists = async (cityId) => {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  if (!city || !city.isActive) throw ApiError.badRequest('Unknown or inactive city');
};

const completeCustomerOnboarding = async (userId, { name, phone, cityId, address }) => {
  await assertCityExists(cityId);
  await assertPhoneAvailable(userId, phone);

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(name && { name }),
      ...(phone && { phone }),
      cityId,
      address,
      isOnboarded: true,
    },
  });
};

module.exports = { getStatus, completeCustomerOnboarding };
