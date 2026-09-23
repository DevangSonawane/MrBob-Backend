const { z } = require('zod');

const createCategory = {
  body: z.object({
    name: z.string().min(2),
    tier: z.enum(['REPAIR', 'RENOVATION', 'RECURRING']),
    basePrice: z.coerce.number().positive(),
  }),
};

module.exports = { createCategory };
