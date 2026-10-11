const { z } = require('zod');

// Field-level Zod schemas shared by the request schemas of several modules.

const phone = z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number, use E.164 format e.g. +919812345678');

// Optional free text: missing, null or blank all mean "not provided".
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

// Optional value with a format (phone, UPI id, date): forms send "" for an
// empty field, which should mean "not provided" rather than fail the format.
const optionalFormatted = (schema) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullish().transform((value) => value || null));

const gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
const dateOnly = z.iso.date('Use YYYY-MM-DD');
const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Pincode must be 6 digits');

module.exports = { phone, optionalText, optionalFormatted, gender, dateOnly, pincode };
