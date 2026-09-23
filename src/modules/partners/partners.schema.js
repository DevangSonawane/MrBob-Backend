const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const createPartner = {
  body: z.object({
    type: z.enum(['BUILDER', 'RWA']),
    name: z.string().min(2),
    cityId: z.string().uuid(),
    contact: z.string().optional(),
  }),
};

const listPartners = {
  query: paginationQuery.extend({
    cityId: z.string().uuid().optional(),
    type: z.enum(['BUILDER', 'RWA']).optional(),
  }),
};

module.exports = { createPartner, listPartners };
