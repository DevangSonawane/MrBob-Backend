const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { isAdmin } = require('../../utils/roles');
const razorpay = require('./razorpay.client');
const bookings = require('../bookings/bookings.service');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { dateRange, personSearch } = require('../../utils/queryFilters');

// Orders for bookings are created by the booking flow itself (see
// bookings.service.js create); this module covers looking a payment up and
// reacting to what the gateway tells us.

const createOrderForSubscription = async (subscriptionId, amount) => {
  const subscription = await prisma.aMCSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) throw ApiError.notFound('Subscription not found');

  const order = await razorpay.createOrder({ amount, receipt: `amc_${subscriptionId}` });

  const payment = await prisma.payment.create({
    data: {
      subscriptionId,
      amount,
      gatewayRef: order.id,
      status: 'CREATED',
    },
  });

  return { payment, order };
};

// A payment is visible to admins, and to the customer whose booking or
// subscription it pays for.
const getById = async (id, user) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { booking: { select: { customerId: true } }, subscription: { select: { customerId: true } } },
  });
  if (!payment) throw ApiError.notFound('Payment not found');

  const ownerId = payment.booking?.customerId ?? payment.subscription?.customerId;
  if (!isAdmin(user.role) && ownerId !== user.id) throw ApiError.forbidden('You do not have access to this payment');

  const { booking: _booking, subscription: _subscription, ...rest } = payment;
  return rest;
};

// Called from the Razorpay webhook handler once the signature is verified.
// The app normally confirms a payment itself; this is the safety net for when
// it never gets the chance (closed mid-payment, lost connection).
const handleGatewayEvent = async ({ event, orderId, paymentId }) => {
  const payment = await prisma.payment.findFirst({ where: { gatewayRef: orderId } });
  if (!payment) return null;

  if (event === 'payment.captured') {
    if (payment.bookingId) return bookings.markPaid(payment.bookingId, { gatewayPaymentId: paymentId });
    return prisma.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESS', gatewayPaymentId: paymentId, paidAt: new Date() } });
  }
  // A failed attempt doesn't close the order: the customer can try again.
  if (event === 'payment.failed' && payment.status !== 'SUCCESS') {
    return prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
  }
  return null;
};

// ---------------------------------------------------------------------------
// The team's view of every payment: online ones, money collected after the
// service, refunds, and AMC payments.
// ---------------------------------------------------------------------------

const customerSelect = { select: { id: true, name: true, phone: true, email: true } };
const listInclude = {
  booking: { select: { id: true, sequence: true, paymentMode: true, category: { select: { id: true, name: true } }, customer: customerSelect } },
  subscription: { select: { id: true, plan: true, customer: customerSelect } },
};

const toListView = ({ booking, subscription, amount, ...payment }) => ({
  id: payment.id,
  amount: Number(amount),
  status: payment.status,
  method: payment.method,
  gatewayRef: payment.gatewayRef,
  gatewayPaymentId: payment.gatewayPaymentId,
  refundReference: payment.refundReference,
  paidAt: payment.paidAt,
  refundedAt: payment.refundedAt,
  createdAt: payment.createdAt,
  // What it paid for, and who paid.
  kind: booking ? 'BOOKING' : 'SUBSCRIPTION',
  booking: booking ? { id: booking.id, bookingNumber: bookings.bookingNumber(booking.sequence), paymentMode: booking.paymentMode, service: booking.category } : null,
  subscription: subscription ? { id: subscription.id, plan: subscription.plan } : null,
  customer: booking?.customer ?? subscription?.customer ?? null,
});

const listAll = async ({ page, limit, status, kind, method, createdFrom, createdTo, search }) => {
  const createdAt = dateRange(createdFrom, createdTo);
  // "BK-000123" (or just its digits) finds that booking's payment.
  const sequence = search && /^(bk-?)?\d{1,9}$/i.test(search) ? Number(search.replace(/\D/g, '')) : null;
  const where = {
    ...(status && { status: { in: status } }),
    ...(kind === 'BOOKING' && { bookingId: { not: null } }),
    ...(kind === 'SUBSCRIPTION' && { subscriptionId: { not: null } }),
    ...(method && { method }),
    ...(createdAt && { createdAt }),
    ...(search && {
      OR: [
        ...(sequence !== null ? [{ booking: { is: { sequence } } }] : []),
        { gatewayRef: { contains: search } },
        { gatewayPaymentId: { contains: search } },
        { booking: { is: { customer: personSearch(search) } } },
        { subscription: { is: { customer: personSearch(search) } } },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({ where, include: listInclude, orderBy: { createdAt: 'desc' }, ...toSkipTake({ page, limit }) }),
    prisma.payment.count({ where }),
  ]);
  return paginatedResponse(rows.map(toListView), total, { page, limit });
};

const getSummary = async () => {
  const sumOf = (where) => prisma.payment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } });
  const [collected, online, refundPending, refunded, failed] = await Promise.all([
    sumOf({ status: 'SUCCESS' }),
    sumOf({ status: 'SUCCESS', method: 'ONLINE' }),
    sumOf({ status: 'REFUND_PENDING' }),
    sumOf({ status: 'REFUNDED' }),
    sumOf({ status: 'FAILED' }),
  ]);
  const view = (result) => ({ count: result._count._all, amount: Number(result._sum.amount ?? 0) });
  return { collected: view(collected), collectedOnline: view(online), refundPending: view(refundPending), refunded: view(refunded), failed: view(failed) };
};

module.exports = { createOrderForSubscription, getById, handleGatewayEvent, listAll, getSummary };
