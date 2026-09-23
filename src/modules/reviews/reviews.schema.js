const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const createReview = {
  body: z.object({
    bookingId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).optional(),
  }),
};

const listForProfessional = {
  params: z.object({ professionalId: z.string().uuid() }),
  query: paginationQuery,
};

module.exports = { createReview, listForProfessional };
