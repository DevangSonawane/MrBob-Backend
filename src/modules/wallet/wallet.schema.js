const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { booleanFlag } = require('../../utils/queryFilters');

const professionalId = z.object({ professionalId: z.uuid() });

const METHODS = ['BANK_TRANSFER', 'UPI', 'CASH'];
const commissionPercent = z.coerce.number().min(0).max(100);
const holdDays = z.coerce.number().int().min(0).max(60);

// The platform default for every vendor. Send only what changes.
const updateSettings = {
  body: z
    .object({
      holdDays: holdDays.optional(),
      commissionPercent: commissionPercent.optional(),
      payoutMethod: z.enum(METHODS).optional(),
      frequency: z.enum(['AFTER_HOLD', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).optional(),
      firstPayoutDate: z.iso.date('Use YYYY-MM-DD').nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to change' }),
};

// One vendor's own terms; null puts that field back on the platform default.
const vendorTermsFields = {
  commissionPercent: commissionPercent.nullable().optional(),
  holdDays: holdDays.nullable().optional(),
  payoutMethod: z.enum(METHODS).nullable().optional(),
};
const setVendorTerms = { params: professionalId, body: z.object(vendorTermsFields).refine((data) => Object.keys(data).length > 0, { message: 'Nothing to change' }) };
const setManyVendorTerms = {
  body: z.object({
    professionalIds: z.array(z.uuid()).min(1).max(500).optional(), // omit for every vendor
    reset: z.boolean().optional(), // true: back on the platform default
    ...vendorTermsFields,
  }),
};
const listVendorTerms = { query: paginationQuery.extend({ search: z.string().trim().min(1).max(100).optional(), customOnly: booleanFlag.optional() }) };

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
    method: z.enum(METHODS).optional(), // defaults to the vendor's payout method
  }),
};
const listPayouts = { query: paginationQuery.extend({ professionalId: z.uuid().optional(), search: z.string().trim().min(1).max(100).optional() }) };

module.exports = { updateSettings, setVendorTerms, setManyVendorTerms, listVendorTerms, listTransactions, listPending, listDue, vendorWallet, vendorTransactions, vendorPending, createPayout, listPayouts };
