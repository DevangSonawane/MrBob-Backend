const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const listUsers = {
  query: paginationQuery.extend({
    role: z.enum(['CUSTOMER', 'PROFESSIONAL', 'ADMIN']).optional(),
    cityId: z.string().uuid().optional(),
  }),
};

const getUser = {
  params: z.object({ id: z.string().uuid() }),
};

const updateMe = {
  body: z
    .object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional(),
      cityId: z.string().uuid().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' }),
};

const setActive = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ isActive: z.boolean() }),
};

module.exports = { listUsers, getUser, updateMe, setActive };
