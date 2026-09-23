const { z } = require('zod');

const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number, use E.164 format e.g. +919812345678');

const completeCustomer = {
  body: z.object({
    name: z.string().min(2).optional(),
    phone: phoneSchema.optional(),
    cityId: z.string().uuid(),
    address: z.string().min(5).optional(),
  }),
};

const completeProfessional = {
  body: z.object({
    name: z.string().min(2).optional(),
    phone: phoneSchema.optional(),
    cityId: z.string().uuid(),
    categories: z.array(z.string()).min(1),
    homeZoneId: z.string().uuid().optional(),
  }),
};

module.exports = { completeCustomer, completeProfessional };
