const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const razorpay = require('./razorpay.client');

const createOrderForBooking = async (bookingId) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.payment) throw ApiError.conflict('A payment already exists for this booking');
  if (!booking.price) throw ApiError.badRequest('Booking has no price set');

  const order = await razorpay.createOrder({ amount: Number(booking.price), receipt: `booking_${bookingId}` });

  const payment = await prisma.payment.create({
    data: {
      bookingId,
      amount: booking.price,
      gatewayRef: order.id,
      status: 'CREATED',
    },
  });

  return { payment, order };
};

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

const getById = async (id) => {
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) throw ApiError.notFound('Payment not found');
  return payment;
};

// Called from the Razorpay webhook handler once the signature is verified.
const markStatusByGatewayRef = async (gatewayRef, status) => {
  const payment = await prisma.payment.findFirst({ where: { gatewayRef } });
  if (!payment) return null;
  return prisma.payment.update({ where: { id: payment.id }, data: { status } });
};

module.exports = { createOrderForBooking, createOrderForSubscription, getById, markStatusByGatewayRef };
