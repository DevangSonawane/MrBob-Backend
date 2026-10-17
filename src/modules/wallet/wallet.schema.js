const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { booleanFlag } = require('../../utils/queryFilters');

const professionalId = z.object({ professionalId: z.uuid() });

const METHODS = ['BANK_TRANSFER', 'UPI', 'CASH'];
const commissionPercent = z.coerce.number().min(0).max(100);
// The hold period in minutes (the dashboard sends days, hours and minutes added up); at most 60 days.
const holdMinutes = z.coerce.number().int().min(0).max(60 * 24 * 60);

// The platform default for every vendor. Send only what changes.
const updateSettings = {
  body: z
    .object({
      holdMinutes: holdMinutes.optional(),
      commissionPercent: commissionPercent.optional(),
      payoutMethod: z.enum(METHODS).optional(),
      frequency: z.enum(['AFTER_HOLD', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).optional(),
      firstPayoutDate: z.iso.date('Use YYYY-MM-DD').nullable().optional(),
      automaticPayouts: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to change' }),
};

// One vendor's own terms; null puts that field back on the platform default.
const vendorTermsFields = {
  commissionPercent: commissionPercent.nullable().optional(),
  holdMinutes: holdMinutes.nullable().optional(),
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
    includeOnHold: z.boolean().optional(), // also settle earnings still on hold
  }),
};

// Send the vendor's money now through the payout provider.
const sendPayout = {
  params: professionalId,
  body: z.object({
    method: z.enum(['BANK_TRANSFER', 'UPI']).optional(), // defaults to the vendor's payout method
    includeOnHold: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
  }),
};

// Where the vendor is paid. Only what is sent changes; empty upiId removes it.
const payoutAccountBody = z
  .object({
      accountHolderName: z.string().trim().min(2).max(100).optional(),
      accountNumber: z.string().trim().regex(/^\d[\d\s]{7,19}$/, 'Account number must be 9 to 18 digits').optional(),
      ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like HDFC0001234').optional(),
      bankName: z.string().trim().max(100).nullish(),
      branchName: z.string().trim().max(100).nullish(),
      accountType: z.enum(['SAVINGS', 'CURRENT']).nullish(),
      upiId: z.union([z.string().trim().regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, 'UPI id looks like name@bank'), z.literal('')]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to change' });
const setPayoutAccount = { params: professionalId, body: payoutAccountBody };
const setOwnPayoutAccount = { body: payoutAccountBody };

const listPayouts = { query: paginationQuery.extend({ professionalId: z.uuid().optional(), search: z.string().trim().min(1).max(100).optional() }) };

module.exports = { sendPayout, setPayoutAccount, setOwnPayoutAccount, updateSettings, setVendorTerms, setManyVendorTerms, listVendorTerms, listTransactions, listPending, listDue, vendorWallet, vendorTransactions, vendorPending, createPayout, listPayouts };
