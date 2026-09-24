const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const createSubscription = {
  body: z.object({
    plan: z.string().min(2),
    startDate: z.coerce.date(),
    renewalDate: z.coerce.date(),
  }),
};

const listSubscriptions = {
  query: paginationQuery.extend({
    status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
  }),
};

const getSubscription = {
  params: z.object({ id: z.string().uuid() }),
};

module.exports = { createSubscription, listSubscriptions, getSubscription };
