const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { commaList, dateOnly } = require('../../utils/queryFilters');

const listPayments = {
  query: paginationQuery.extend({
    status: commaList(['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED']).optional(),
    kind: z.enum(['BOOKING', 'SUBSCRIPTION']).optional(),
    method: z.enum(['ONLINE', 'CASH', 'UPI', 'CARD']).optional(),
    createdFrom: dateOnly.optional(),
    createdTo: dateOnly.optional(),
    search: z.string().trim().min(1).max(100).optional(), // BK-000123, gateway id, or the customer's name / phone / email
  }),
};

const createOrderForSubscription = {
  params: z.object({ subscriptionId: z.string().uuid() }),
};

const getPayment = {
  params: z.object({ id: z.string().uuid() }),
};

module.exports = { createOrderForSubscription, getPayment, listPayments };
