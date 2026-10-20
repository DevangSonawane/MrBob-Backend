const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const storage = require('../storage/storage.service');

// Deleting an account. The user row is kept, because bookings, payments and
// reviews still reference it, but everything personal is wiped: name, phone,
// email, password, addresses, photo, and for vendors their KYC documents and
// bank details. The phone number and email become free to register again.

const DELETED_NAME = 'Deleted user';

const deleteAccount = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { professional: { include: { documents: true } } },
  });
  if (!user || user.deletedAt) throw ApiError.notFound('User not found');

  // A job someone has committed to has to be finished or cancelled first.
  const committed = await prisma.booking.count({
    where: {
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
      OR: [{ customerId: userId }, ...(user.professional ? [{ professionalId: user.professional.id }] : [])],
    },
  });
  if (committed > 0) {
    throw ApiError.conflict('This account has bookings in progress. Complete or cancel them before deleting the account.');
  }

  const professional = user.professional;
  const fileKeys = [
    user.profilePhotoKey,
    professional?.profilePhotoKey,
    ...(professional?.documents ?? []).flatMap((doc) => [doc.frontFileKey, doc.backFileKey]),
  ].filter(Boolean);

  await prisma.$transaction(async (tx) => {
    // Requests nobody has picked up yet are simply withdrawn.
    await tx.booking.updateMany({
      where: { customerId: userId, status: { in: ['AWAITING_PAYMENT', 'PENDING', 'MATCHING'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'SYSTEM', cancellationReason: 'Account deleted' },
    });
    await tx.aMCSubscription.updateMany({ where: { customerId: userId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
    await tx.address.deleteMany({ where: { userId } });
    // Signed out everywhere.
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

    if (professional) {
      await tx.professionalDocument.deleteMany({ where: { professionalId: professional.id } });
      await tx.professional.update({
        where: { id: professional.id },
        data: {
          // No longer dispatchable, and nothing personal left on the record.
          categories: [],
          kycStatus: 'REJECTED',
          onboardingStatus: 'REJECTED',
          reviewNote: 'Account deleted',
          homeZoneId: null,
          dateOfBirth: null,
          gender: null,
          alternatePhone: null,
          addressLine1: null,
          addressLine2: null,
          landmark: null,
          pincode: null,
          state: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          experienceYears: null,
          profilePhotoKey: null,
          profilePhotoMime: null,
        },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        name: DELETED_NAME,
        phone: null,
        email: null,
        passwordHash: null,
        address: null,
        cityId: null,
        gender: null,
        dateOfBirth: null,
        profilePhotoKey: null,
        profilePhotoMime: null,
        isActive: false,
        deletedAt: new Date(),
      },
    });
  });

  await Promise.all(fileKeys.map(storage.remove));
  return { deleted: true };
};

module.exports = { deleteAccount, DELETED_NAME };
