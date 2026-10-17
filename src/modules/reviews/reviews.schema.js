const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { dateOnly, sortOrder } = require('../../utils/queryFilters');

const ratingBody = z.object({
  rating: z.coerce.number().int().min(1, 'Give 1 to 5 stars').max(5, 'Give 1 to 5 stars'),
  comment: z.string().trim().max(1000).optional(),
});

const createReview = { body: ratingBody.extend({ bookingId: z.uuid() }) };

// The customer or vendor rating one of their completed bookings.
const rateBooking = { params: z.object({ id: z.uuid() }), body: ratingBody };

const listForProfessional = {
  params: z.object({ professionalId: z.uuid() }),
  query: paginationQuery,
};

const listAll = {
  query: paginationQuery.extend({
    authorRole: z.enum(['CUSTOMER', 'PROFESSIONAL']).optional(), // CUSTOMER = ratings of vendors, PROFESSIONAL = ratings of customers
    rating: z.coerce.number().int().min(1).max(5).optional(),
    maxRating: z.coerce.number().int().min(1).max(5).optional(), // e.g. 2 for the poor ones
    professionalId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    search: z.string().trim().min(1).max(100).optional(),
    createdFrom: dateOnly.optional(),
    createdTo: dateOnly.optional(),
    sortBy: z.enum(['createdAt', 'rating']).default('createdAt'),
    sortOrder: sortOrder.default('desc'),
  }),
};

module.exports = { createReview, rateBooking, listForProfessional, listAll };
