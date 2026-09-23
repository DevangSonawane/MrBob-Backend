const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const ALLOWED_TRANSITIONS = {
  PENDING: ['MATCHING', 'CANCELLED'],
  MATCHING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const create = async (customerId, { categoryId, address, scheduledAt, partnerId }) => {
  const category = await prisma.serviceCategory.findUnique({ where: { id: categoryId } });
  if (!category || !category.isActive) throw ApiError.badRequest('Unknown or inactive service category');

  return prisma.booking.create({
    data: {
      customerId,
      categoryId,
      address,
      scheduledAt,
      partnerId,
      price: category.basePrice,
      status: 'PENDING',
    },
  });
};

const listForUser = async (user, { page, limit, status }) => {
  const where = {
    ...(status && { status }),
    ...(user.role === 'CUSTOMER' && { customerId: user.id }),
  };

  if (user.role === 'PROFESSIONAL') {
    const professional = await prisma.professional.findUnique({ where: { userId: user.id } });
    where.professionalId = professional?.id ?? '__none__';
  }

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      ...toSkipTake({ page, limit }),
      orderBy: { createdAt: 'desc' },
      include: { category: true },
    }),
    prisma.booking.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

const getByIdForUser = async (id, user) => {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { category: true, payment: true, professional: { include: { user: true } } },
  });
  if (!booking) throw ApiError.notFound('Booking not found');

  const isOwner = user.role === 'ADMIN' || booking.customerId === user.id || booking.professional?.userId === user.id;
  if (!isOwner) throw ApiError.forbidden('You do not have access to this booking');

  return booking;
};

const updateStatus = async (id, nextStatus) => {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw ApiError.notFound('Booking not found');

  const allowed = ALLOWED_TRANSITIONS[booking.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(`Cannot transition booking from ${booking.status} to ${nextStatus}`);
  }

  return prisma.booking.update({ where: { id }, data: { status: nextStatus } });
};

module.exports = { create, listForUser, getByIdForUser, updateStatus, ALLOWED_TRANSITIONS };
