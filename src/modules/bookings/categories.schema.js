const { z } = require('zod');

const createCategory = {
  body: z.object({
    name: z.string().min(2),
    tier: z.enum(['REPAIR', 'RENOVATION', 'RECURRING']),
    basePrice: z.coerce.number().positive(),
  }),
};

const categoryOnly = { params: z.object({ id: z.uuid() }) };

// Every field optional; only what is sent changes. Existing bookings keep the price they were made at.
const updateCategory = {
  params: categoryOnly.params,
  body: z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      tier: z.enum(['REPAIR', 'RENOVATION', 'RECURRING']).optional(),
      basePrice: z.coerce.number().positive().max(1000000).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

module.exports = { createCategory, categoryOnly, updateCategory };
