const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { booleanFlag } = require('../../utils/queryFilters');

const professionalId = z.object({ professionalId: z.uuid() });

const transactionFilters = {
  type: z.enum(['EARNING', 'PAYOUT']).optional(),
  // ON_HOLD and READY split what is still to be sent; PENDING is both together.
  status: z.enum(['ON_HOLD', 'READY', 'PENDING', 'PAID', 'SETTLED_IN_CASH']).optional(),
};

const listTransactions = { query: paginationQuery.extend(transactionFilters) };
const listPending = { query: paginationQuery };

// --- The team ---
const listDue = { query: paginationQuery.extend({ search: z.string().trim().min(1).max(100).optional(), readyOnly: booleanFlag.optional() }) };
const vendorWallet = { params: professionalId };
const vendorTransactions = { params: professionalId, query: paginationQuery.extend(transactionFilters) };
const vendorPending = { params: professionalId, query: paginationQuery };
const createPayout = {
  params: professionalId,
  body: z.object({
    reference: z.string().trim().min(3, 'Enter the bank or UPI transaction reference').max(200),
    note: z.string().trim().max(500).optional(),
  }),
};
const listPayouts = { query: paginationQuery.extend({ professionalId: z.uuid().optional(), search: z.string().trim().min(1).max(100).optional() }) };

module.exports = { listTransactions, listPending, listDue, vendorWallet, vendorTransactions, vendorPending, createPayout, listPayouts };
