const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { isAdmin } = require('../../utils/roles');
const { personSearch } = require('../../utils/queryFilters');

const RENEWAL_WINDOW_DAYS = 60;

const create = (customerId, data) =>
  prisma.aMCSubscription.create({ data: { customerId, ...data, status: 'ACTIVE' } });

const list = async (user, { page, limit, status, search }) => {
  const where = {
    ...(status && { status }),
    ...(!isAdmin(user.role) && { customerId: user.id }),
    // The team searches by plan or by the customer's name, phone or email.
    ...(search && isAdmin(user.role) && { OR: [{ plan: { contains: search, mode: 'insensitive' } }, { customer: personSearch(search) }] }),
  };
  const [items, total] = await Promise.all([
    prisma.aMCSubscription.findMany({
      where,
      ...toSkipTake({ page, limit }),
      orderBy: { createdAt: 'desc' },
      ...(isAdmin(user.role) && { include: { customer: { select: { id: true, name: true, phone: true, email: true } } } }),
    }),
    prisma.aMCSubscription.count({ where }),
  ]);
  return paginatedResponse(items, total, { page, limit });
};

const getByIdForUser = async (id, user) => {
  const subscription = await prisma.aMCSubscription.findUnique({ where: { id } });
  if (!subscription) throw ApiError.notFound('Subscription not found');
  if (!isAdmin(user.role) && subscription.customerId !== user.id) {
    throw ApiError.forbidden('You do not have access to this subscription');
  }
  return subscription;
};

const cancel = async (id, user) => {
  const subscription = await getByIdForUser(id, user);
  return prisma.aMCSubscription.update({ where: { id: subscription.id }, data: { status: 'CANCELLED' } });
};

// Headline numbers for the dashboard's subscriptions screen.
const getSummary = async () => {
  const renewBy = new Date(Date.now() + RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [groups, renewingSoon] = await Promise.all([
    prisma.aMCSubscription.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.aMCSubscription.count({ where: { status: 'ACTIVE', renewalDate: { lte: renewBy } } }),
  ]);
  const byStatus = { ACTIVE: 0, EXPIRED: 0, CANCELLED: 0 };
  groups.forEach((group) => {
    byStatus[group.status] = group._count._all;
  });
  return { total: byStatus.ACTIVE + byStatus.EXPIRED + byStatus.CANCELLED, byStatus, renewingSoon, renewalWindowDays: RENEWAL_WINDOW_DAYS };
};

module.exports = { create, list, getSummary, getByIdForUser, cancel };
