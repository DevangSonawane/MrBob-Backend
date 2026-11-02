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
    search: z.string().trim().min(1).max(100).optional(), // admins only: plan, or customer name / phone / email
  }),
};

const getSubscription = {
  params: z.object({ id: z.string().uuid() }),
};

const updateSubscription = {
  params: getSubscription.params,
  body: z
    .object({
      plan: z.string().trim().min(2).max(120).optional(),
      startDate: z.coerce.date().optional(),
      renewalDate: z.coerce.date().optional(),
      status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

module.exports = { createSubscription, listSubscriptions, getSubscription, updateSubscription };
