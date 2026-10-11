const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

// A role-agnostic "is this account set up?" check. The onboarding itself
// lives in modules/customerOnboarding and modules/vendorOnboarding.
const getStatus = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { professional: true } });
  if (!user || user.deletedAt) throw ApiError.notFound('User not found');

  return {
    isOnboarded: user.isOnboarded,
    role: user.role,
    hasProfessionalProfile: Boolean(user.professional),
    // Where a vendor is in /vendor-onboarding; null for accounts that never started it.
    vendorOnboardingStatus: user.professional?.onboardingStatus ?? null,
  };
};

module.exports = { getStatus };
