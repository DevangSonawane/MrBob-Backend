const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { commaList, dateOnly, sortOrder } = require('../../utils/queryFilters');
const { OTP_LENGTH } = require('../auth/otp.store');

const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number, use E.164 format e.g. +919812345678');

// Optional text: a missing, null or blank value all mean "not provided".
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

// Optional formatted value (phone, UPI id): forms send "" for an empty field,
// which should mean "not provided" rather than fail the format check.
const optionalFormatted = (schema) => z.preprocess((value) => (value === '' ? null : value), schema.nullish().transform((value) => value || null));

const ONBOARDING_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'];
const IDENTITY_DOCUMENT_TYPES = ['AADHAAR', 'PAN'];
// Everything that gets verified before approval; the bank account is saved
// through its own endpoint but reviewed like a document.
const DOCUMENT_TYPES = [...IDENTITY_DOCUMENT_TYPES, 'BANK_ACCOUNT'];

// /documents/aadhaar or /documents/AADHAAR both work.
const typeParam = (types) =>
  z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(types));
const documentTypeParam = typeParam(DOCUMENT_TYPES);

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);

const requestOtp = {
  body: z.object({ phone: phoneSchema }),
};

const verifyOtp = {
  body: z.object({ phone: phoneSchema, otp: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `OTP must be ${OTP_LENGTH} digits`) }),
};

const savePersonalDetails = {
  body: z
    .object({
      name: z.string().trim().min(2).max(100),
      dateOfBirth: z.iso.date('Use YYYY-MM-DD'),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
      phone: phoneSchema.optional(), // only needed when the account has no phone yet
      email: z.email().optional(),
      alternatePhone: optionalFormatted(phoneSchema),
      cityId: z.uuid(),
      addressLine1: z.string().trim().min(5).max(200),
      addressLine2: optionalText(200),
      landmark: optionalText(120),
      pincode: z.string().regex(/^[1-9]\d{5}$/, 'Pincode must be 6 digits'),
      state: z.string().trim().min(2).max(60),
      emergencyContactName: optionalText(100),
      emergencyContactPhone: optionalFormatted(phoneSchema),
    })
    .refine((data) => Boolean(data.emergencyContactName) === Boolean(data.emergencyContactPhone), {
      message: 'Provide both an emergency contact name and phone, or neither',
      path: ['emergencyContactPhone'],
    }),
};

const saveServices = {
  body: z.object({
    categories: z
      .array(z.uuid())
      .min(1, 'Select at least one service')
      .max(20)
      .transform((ids) => [...new Set(ids)]),
    experienceYears: z.coerce.number().int().min(0).max(60),
    homeZoneId: z.uuid().nullish().transform((value) => value || null),
  }),
};

// multipart/form-data: `number` and `nameOnDocument` as text fields, files as
// `front` (and `back` for Aadhaar). The number's format is checked in the
// service, where the document type is known.
const saveDocument = {
  params: z.object({ type: typeParam(IDENTITY_DOCUMENT_TYPES) }),
  body: z.object({
    number: z.string().trim().min(8).max(20),
    nameOnDocument: z.string().trim().min(2).max(100),
  }),
};

// multipart/form-data, with the cancelled cheque / passbook page as `proof`.
const saveBankDetails = {
  body: z.object({
    accountHolderName: z.string().trim().min(2).max(100),
    accountNumber: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits')),
    ifsc: z
      .string()
      .transform((value) => value.trim().toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character IFSC, e.g. HDFC0001234')),
    bankName: z.string().trim().min(2).max(100),
    branchName: optionalText(100),
    accountType: z.enum(['SAVINGS', 'CURRENT']),
    upiId: optionalFormatted(z.string().trim().regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, 'Enter a valid UPI ID, e.g. name@bank')),
  }),
};

const documentFile = {
  params: z.object({ type: documentTypeParam, side: z.enum(['front', 'back']) }),
};

const listApplications = {
  query: paginationQuery.extend({
    status: commaList(ONBOARDING_STATUSES).optional(), // one status or several, comma-separated
    cityId: z.uuid().optional(),
    zoneId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    search: z.string().trim().min(1).max(100).optional(),
    submittedFrom: dateOnly.optional(),
    submittedTo: dateOnly.optional(),
    sortBy: z.enum(['submittedAt', 'createdAt', 'reviewedAt', 'name']).optional(),
    sortOrder: sortOrder.optional(),
  }),
};

const applicationParams = {
  params: z.object({ id: z.uuid() }),
};

const applicationDocumentParams = {
  params: z.object({ id: z.uuid(), type: documentTypeParam }),
};

const applicationDocumentFile = {
  params: z.object({ id: z.uuid(), type: documentTypeParam, side: z.enum(['front', 'back']) }),
};

const rejectDocument = {
  ...applicationDocumentParams,
  body: z.object({ reason }),
};

const rejectApplication = {
  ...applicationParams,
  body: z.object({ reason }),
};

const reopenApplication = {
  ...applicationParams,
  body: z.object({ reason }),
};

const requestChanges = {
  ...applicationParams,
  body: z.object({
    reason,
    // Documents the vendor must upload again (they are marked rejected with this reason).
    documents: z.array(z.enum(DOCUMENT_TYPES)).max(DOCUMENT_TYPES.length).default([]),
  }),
};

module.exports = {
  DOCUMENT_TYPES,
  requestOtp,
  verifyOtp,
  savePersonalDetails,
  saveServices,
  saveDocument,
  saveBankDetails,
  documentFile,
  listApplications,
  applicationParams,
  applicationDocumentParams,
  applicationDocumentFile,
  rejectDocument,
  rejectApplication,
  reopenApplication,
  requestChanges,
};
