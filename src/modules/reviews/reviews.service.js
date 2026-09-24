const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const recomputeProfessionalRating = async (professionalId) => {
  if (!professionalId) return;
  const result = await prisma.review.aggregate({
    where: { booking: { professionalId } },
    _avg: { rating: true },
  });
  await prisma.professional.update({
    where: { id: professionalId },
    data: { rating: result._avg.rating ?? 0 },
  });
};

const create = async (userId, { bookingId, rating, comment }) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customerId !== userId) throw ApiError.forbidden('You can only review your own bookings');
  if (booking.status !== 'COMPLETED') throw ApiError.badRequest('Only completed bookings can be reviewed');

  const existing = await prisma.review.findUnique({ where: { bookingId } });
  if (existing) throw ApiError.conflict('This booking has already been reviewed');

  const review = await prisma.review.create({ data: { bookingId, userId, rating, comment } });
  await recomputeProfessionalRating(booking.professionalId);
  return review;
};

const listForProfessional = async (professionalId, { page, limit }) => {
  const where = { booking: { professionalId } };
  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      ...toSkipTake({ page, limit }),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.review.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

const listAll = async ({ page, limit, minRating }) => {
  const where = { ...(minRating && { rating: { gte: minRating } }) };
  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      ...toSkipTake({ page, limit }),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true } },
        booking: {
          select: {
            id: true,
            professional: { select: { id: true, user: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
    prisma.review.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

module.exports = { create, listForProfessional, listAll };
