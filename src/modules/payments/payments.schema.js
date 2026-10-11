const { z } = require('zod');

const createOrderForSubscription = {
  params: z.object({ subscriptionId: z.string().uuid() }),
};

const getPayment = {
  params: z.object({ id: z.string().uuid() }),
};

module.exports = { createOrderForSubscription, getPayment };
