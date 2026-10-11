const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');
const { commaList, booleanFlag, dateOnly, sortOrder } = require('../../utils/queryFilters');
const fields = require('../../utils/fieldSchemas');
const { OTP_LENGTH } = require('../auth/otp.store');

const ROLES = ['CUSTOMER', 'PROFESSIONAL', 'ADMIN', 'SUPER_ADMIN'];
const VENDOR_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'];

const name = z.string().trim().min(2).max(100);
const otp = z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `OTP must be ${OTP_LENGTH} digits`);
const nonEmpty = (schema) => schema.refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

// Must be a real date in the past (and not absurdly long ago).
const dateOfBirth = fields.dateOnly.refine((value) => value < new Date().toISOString().slice(0, 10) && value >= '1900-01-01', {
  message: 'Date of birth must be in the past',
});

const userId = z.object({ id: z.uuid() });

// --- The signed-in user ---

const updateMe = {
  body: nonEmpty(
    z.object({
      name: name.optional(),
      gender: fields.gender.optional(),
      email: z.email().optional(),
      dateOfBirth: fields.optionalFormatted(dateOfBirth).optional(),
    }),
  ),
};

const requestPhoneChange = { body: z.object({ phone: fields.phone }) };
const confirmPhoneChange = { body: z.object({ phone: fields.phone, otp }) };

// --- Addresses ---

const addressFields = {
  label: z.enum(['HOME', 'WORK', 'OTHER']),
  contactName: fields.optionalText(100),
  contactPhone: fields.optionalFormatted(fields.phone),
  line1: z.string().trim().min(5).max(200),
  line2: fields.optionalText(200),
  landmark: fields.optionalText(120),
  cityId: z.uuid(),
  zoneId: z.uuid().nullish(),
  state: z.string().trim().min(2).max(60),
  pincode: fields.pincode,
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  isDefault: z.boolean().optional(),
};

// Both coordinates or neither.
const coordinatesTogether = (data) => (data.latitude === undefined || data.latitude === null) === (data.longitude === undefined || data.longitude === null);
const coordinatesMessage = { message: 'Send latitude and longitude together', path: ['longitude'] };

const addressBody = z.object({ ...addressFields, label: addressFields.label.default('HOME') }).refine(coordinatesTogether, coordinatesMessage);

const createAddress = { body: addressBody };

const addressParams = z.object({ addressId: z.uuid() });

const updateAddress = {
  params: addressParams,
  // Every field optional; only what is sent changes.
  body: nonEmpty(z.object(Object.fromEntries(Object.entries(addressFields).map(([key, schema]) => [key, schema.optional()])))),
};

const addressOnly = { params: addressParams };

// --- Administration ---

const listUsers = {
  query: paginationQuery.extend({
    role: commaList(ROLES).optional(), // one role or several, comma-separated
    gender: fields.gender.optional(),
    cityId: z.uuid().optional(),
    isActive: booleanFlag.optional(),
    isOnboarded: booleanFlag.optional(),
    vendorStatus: commaList(VENDOR_STATUSES).optional(), // vendors in these onboarding statuses
    deleted: booleanFlag.optional(), // true = only deleted accounts; default hides them
    search: z.string().trim().min(1).max(100).optional(),
    createdFrom: dateOnly.optional(),
    createdTo: dateOnly.optional(),
    sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
    sortOrder: sortOrder.default('desc'),
  }),
};

const getUser = { params: userId };

const setActive = {
  params: userId,
  body: z.object({ isActive: z.boolean() }),
};

const adminUpdate = {
  params: userId,
  body: nonEmpty(
    z.object({
      name: name.optional(),
      email: z.email().optional(),
      phone: fields.phone.optional(),
      gender: fields.gender.optional(),
      dateOfBirth: fields.optionalFormatted(dateOfBirth).optional(),
      role: z.enum(ROLES).optional(),
      isActive: z.boolean().optional(),
    }),
  ),
};

// Every field optional; null (or an empty string) clears it.
const part = (max) => z.string().trim().max(max).nullable().optional();
const setLocation = {
  params: userId,
  body: nonEmpty(
    z.object({
      addressLine1: part(200),
      addressLine2: part(200),
      landmark: part(200),
      state: part(60),
      pincode: part(10),
      cityId: z.uuid().nullable().optional(),
      zoneId: z.uuid().nullable().optional(),
    }),
  ),
};

const createUser = {
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(ROLES).default('ADMIN'), // SUPER_ADMIN: super admins only
    password: z.string().min(8).max(72).optional(), // omit to auto-generate a temp password
  }),
};

module.exports = {
  addressBody,
  updateMe,
  requestPhoneChange,
  confirmPhoneChange,
  createAddress,
  updateAddress,
  addressOnly,
  listUsers,
  getUser,
  setActive,
  adminUpdate,
  setLocation,
  createUser,
};
