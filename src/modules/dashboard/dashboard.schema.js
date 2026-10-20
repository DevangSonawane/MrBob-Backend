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

module.exports = { overview, analytics };
