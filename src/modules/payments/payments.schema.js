const { z } = require('zod');

const createOrderForBooking = {
  params: z.object({ bookingId: z.string().uuid() }),
};

const createOrderForSubscription = {
  params: z.object({ subscriptionId: z.string().uuid() }),
};

const getPayment = {
  params: z.object({ id: z.string().uuid() }),
};

module.exports = { createOrderForBooking, createOrderForSubscription, getPayment };
