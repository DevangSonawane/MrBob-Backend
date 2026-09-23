const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const createBooking = {
  body: z.object({
    categoryId: z.string().uuid(),
    address: z.string().min(5),
    scheduledAt: z.coerce.date().optional(),
    partnerId: z.string().uuid().optional(),
  }),
};

const listBookings = {
  query: paginationQuery.extend({
    status: z.enum(['PENDING', 'MATCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  }),
};

const getBooking = {
  params: z.object({ id: z.string().uuid() }),
};

const updateStatus = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    status: z.enum(['MATCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  }),
};

module.exports = { createBooking, listBookings, getBooking, updateStatus };
