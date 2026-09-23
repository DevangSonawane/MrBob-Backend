const { z } = require('zod');

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const toSkipTake = ({ page, limit }) => ({ skip: (page - 1) * limit, take: limit });

const paginatedResponse = (items, total, { page, limit }) => ({
  items,
  meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
});

module.exports = { paginationQuery, toSkipTake, paginatedResponse };
