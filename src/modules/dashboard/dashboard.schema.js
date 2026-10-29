const { z } = require('zod');

const months = z.coerce.number().int().refine((value) => [3, 6, 12].includes(value), 'Choose 3, 6 or 12 months').default(6);

const overview = { query: z.object({ months }) };
const analytics = {
  query: z.object({
    type: z.enum(['bookings', 'vendors']).default('bookings'),
    months,
    cityId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
  }),
};

const bestSellers = {
  query: z.object({ days: z.coerce.number().int().refine((value) => [30, 90, 180].includes(value), 'Choose 30, 90 or 180 days').default(90) }),
};

module.exports = { overview, analytics, bestSellers };
