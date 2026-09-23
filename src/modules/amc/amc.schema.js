const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const createSubscription = {
  body: z.object({
    plan: z.string().min(2),
    startDate: z.coerce.date(),
    renewalDate: z.coerce.date(),
  }),
};

const listMine = {
  query: paginationQuery,
};

const getSubscription = {
  params: z.object({ id: z.string().uuid() }),
};

module.exports = { createSubscription, listMine, getSubscription };
