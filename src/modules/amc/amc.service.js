const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');

const create = (customerId, data) =>
  prisma.aMCSubscription.create({ data: { customerId, ...data, status: 'ACTIVE' } });

const listForCustomer = async (customerId, { page, limit }) => {
  const where = { customerId };
  const [items, total] = await Promise.all([
    prisma.aMCSubscription.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { createdAt: 'desc' } }),
    prisma.aMCSubscription.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

const getByIdForUser = async (id, user) => {
  const subscription = await prisma.aMCSubscription.findUnique({ where: { id } });
  if (!subscription) throw ApiError.notFound('Subscription not found');
  if (user.role !== 'ADMIN' && subscription.customerId !== user.id) {
    throw ApiError.forbidden('You do not have access to this subscription');
  }
  return subscription;
};

const cancel = async (id, user) => {
  const subscription = await getByIdForUser(id, user);
  return prisma.aMCSubscription.update({ where: { id: subscription.id }, data: { status: 'CANCELLED' } });
};

module.exports = { create, listForCustomer, getByIdForUser, cancel };
