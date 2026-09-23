// Dispatch/matching module — kept logically separate from bookings.service.js
// even though it shares the same Postgres instance today, so this can be
// extracted into its own service first (see architecture doc: dispatch is
// "the most CPU- and latency-sensitive path" and the first extraction
// candidate). Do not reach into other modules' tables from outside here —
// only via Prisma models that mirror what would be cross-service calls.

const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');

const MAX_CANDIDATES = 10;

// Naive candidate search for MVP: verified professionals serving the
// booking's category, same home zone if the booking has one, ranked by
// rating. Replace with real geo-distance / live-ETA ranking (Google Maps +
// Firebase presence) once professional live location is wired up.
const findCandidates = async (bookingId) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { category: true } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (!['PENDING', 'MATCHING'].includes(booking.status)) {
    throw ApiError.badRequest(`Booking is already ${booking.status}, cannot search for candidates`);
  }

  const candidates = await prisma.professional.findMany({
    where: {
      kycStatus: 'VERIFIED',
      categories: { has: booking.categoryId },
    },
    orderBy: { rating: 'desc' },
    take: MAX_CANDIDATES,
    include: { user: { select: { id: true, name: true, phone: true } } },
  });

  if (booking.status === 'PENDING') {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'MATCHING' } });
  }

  return candidates;
};

const assign = async (bookingId, professionalId) => {
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

  return prisma.booking.update({
    where: { id: bookingId },
    data: { professionalId, status: 'ASSIGNED' },
  });
};

module.exports = { findCandidates, assign };
