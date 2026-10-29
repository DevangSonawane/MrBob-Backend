const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const createPartner = {
  body: z.object({
    type: z.enum(['BUILDER', 'RWA']),
    name: z.string().trim().min(2).max(120),
    cityId: z.string().uuid(),
    contact: z.string().trim().max(120).optional(),
  }),
};

const listPartners = {
  query: paginationQuery.extend({
    cityId: z.string().uuid().optional(),
    type: z.enum(['BUILDER', 'RWA']).optional(),
    search: z.string().trim().min(1).max(100).optional(), // name or contact
  }),
};

module.exports = { createPartner, listPartners };
