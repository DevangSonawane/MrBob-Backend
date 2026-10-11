const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const { isAdmin } = require('../../utils/roles');
const razorpay = require('./razorpay.client');
const bookings = require('../bookings/bookings.service');

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

module.exports = { createOrderForSubscription, getById, handleGatewayEvent };
