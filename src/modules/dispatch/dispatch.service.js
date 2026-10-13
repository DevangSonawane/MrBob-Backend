// Dispatch/matching module — kept logically separate from bookings.service.js
// even though it shares the same Postgres instance today, so this can be
// extracted into its own service first (see architecture doc: dispatch is
// "the most CPU- and latency-sensitive path" and the first extraction
// candidate). Do not reach into other modules' tables from outside here —
// only via Prisma models that mirror what would be cross-service calls.
const { jobOtp } = require('../bookings/bookings.service');

const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

const MAX_CANDIDATES = 10;

// Naive candidate search for MVP: verified professionals serving the
// booking's category, same home zone if the booking has one, ranked by
// rating. Replace with real geo-distance / live-ETA ranking (Google Maps +
// Firebase presence) once professional live location is wired up.
const findCandidates = async (bookingId, actor) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { category: true } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (!['PENDING', 'MATCHING'].includes(booking.status)) {
    throw ApiError.badRequest(`Booking is already ${booking.status}, cannot search for candidates`);
  }

  const candidates = await prisma.professional.findMany({
    where: {
      kycStatus: 'VERIFIED',
      categories: { has: booking.categoryId },
      user: { isActive: true },
    },
    orderBy: { rating: 'desc' },
    take: MAX_CANDIDATES,
    include: { user: { select: { id: true, name: true, phone: true } } },
  });

  if (booking.status === 'PENDING') {
    await prisma.$transaction([
      prisma.booking.update({ where: { id: bookingId }, data: { status: 'MATCHING' } }),
      prisma.bookingEvent.create({ data: { bookingId, type: 'STATUS_CHANGED', actorId: actor?.id ?? null, actorRole: actor ? 'ADMIN' : 'SYSTEM', fromStatus: 'PENDING', toStatus: 'MATCHING' } }),
    ]);
  }

  return candidates;
};

const assign = async (bookingId, professionalId, actor) => {
  const [booking, professional] = await Promise.all([
    prisma.booking.findUnique({ where: { id: bookingId } }),
    prisma.professional.findUnique({ where: { id: professionalId } }),
  ]);

  if (!booking) throw ApiError.notFound('Booking not found');
  if (!professional) throw ApiError.notFound('Professional not found');
  if (!['PENDING', 'MATCHING'].includes(booking.status)) {
    throw ApiError.badRequest(`Booking is already ${booking.status}, cannot assign a professional`);
  }
  if (professional.kycStatus !== 'VERIFIED') {
    throw ApiError.badRequest('Professional is not verified');
  }
  if (!professional.categories.includes(booking.categoryId)) {
    throw ApiError.badRequest('Professional does not serve this category');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: { professionalId, status: 'ASSIGNED', assignedAt: new Date(), startOtp: jobOtp(), startOtpAttempts: 0 },
    });
    await tx.bookingEvent.create({
      data: { bookingId, type: 'ASSIGNED', actorId: actor?.id ?? null, actorRole: actor ? 'ADMIN' : 'SYSTEM', fromStatus: booking.status, toStatus: 'ASSIGNED' },
    });
    return updated;
  });
};

module.exports = { findCandidates, assign };
