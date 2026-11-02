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

const updatePartner = {
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      type: z.enum(['BUILDER', 'RWA']).optional(),
      name: z.string().trim().min(2).max(120).optional(),
      cityId: z.string().uuid().optional(),
      contact: z.string().trim().max(120).nullable().optional(), // null or "" clears it
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

module.exports = { createPartner, listPartners, updatePartner };
