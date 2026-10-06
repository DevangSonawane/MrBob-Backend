const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { commaList, booleanFlag, dateOnly, sortOrder } = require('../../utils/queryFilters');

const ROLES = ['CUSTOMER', 'PROFESSIONAL', 'ADMIN', 'SUPER_ADMIN'];
const VENDOR_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'];

const listUsers = {
  query: paginationQuery.extend({
    role: commaList(ROLES).optional(), // one role or several, comma-separated
    cityId: z.string().uuid().optional(),
    isActive: booleanFlag.optional(),
    isOnboarded: booleanFlag.optional(),
    vendorStatus: commaList(VENDOR_STATUSES).optional(), // vendors in these onboarding statuses
    search: z.string().trim().min(1).max(100).optional(),
    createdFrom: dateOnly.optional(),
    createdTo: dateOnly.optional(),
    sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
    sortOrder: sortOrder.default('desc'),
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

const createUser = {
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(['CUSTOMER', 'PROFESSIONAL', 'ADMIN', 'SUPER_ADMIN']).default('ADMIN'), // SUPER_ADMIN: super admins only
    password: z.string().min(8).max(72).optional(), // omit to auto-generate a temp password
  }),
};

module.exports = { listUsers, getUser, updateMe, setActive, createUser };
