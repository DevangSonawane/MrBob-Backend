const { z } = require('zod');
const env = require('../config/env');
const logger = require('../config/logger');

// Onboarding validation switch.
//
// While the apps are being built, ONBOARDING_VALIDATION=off (the default)
// makes the customer and vendor onboarding endpoints accept whatever they are
// sent. Nothing a client sends is rejected for being missing, malformed or
// against a business rule: every field is optional; phone, pincode, age,
// Aadhaar, PAN, IFSC and UPI formats are not checked; images are optional and
// can be any file type; the same numbers can be reused across accounts; an
// application can be submitted with parts missing.
//
// A value the database cannot hold is dropped rather than refused: an
// unknown city or zone id, an unparseable date, an unknown gender / account
// type / address label, or an email that already belongs to someone else is
// simply not saved, and the request still succeeds.
//
// The one input check that remains is the OTP: it must be the right length
// (see OTP_LENGTH) and must match the code that was sent.
//
// What is not validation and so is unchanged: you must be signed in, you can
// only edit your own application, staff accounts cannot onboard, an
// application under review cannot be edited, and uploads are capped at 5 MB.
//
// Set ONBOARDING_VALIDATION=strict to turn every rule back on. The strict
// rules are the ones the tests in vendorOnboarding.test.js and
// customerOnboarding.test.js pin down.

const relaxed = env.ONBOARDING_VALIDATION !== 'strict';

if (relaxed) {
  logger.warn('ONBOARDING_VALIDATION is off — onboarding endpoints accept unvalidated input. Set it to "strict" before real users sign up.');
}

// Any value as trimmed text; missing, null or blank become null.
const looseText = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}, z.string().nullable());

const looseNumber = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}, z.number().nullable());

// A list of ids sent as an array, a single value, or a comma-separated string.
const looseList = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}, z.array(z.string()));

// Anything Date can parse; null when nothing usable was sent.
const parseLooseDate = (value) => {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Case-insensitive match against a database enum; null when it isn't one of the values.
const parseLooseEnum = (value, values) => {
  if (!value) return null;
  const upper = value.toUpperCase();
  return values.includes(upper) ? upper : null;
};

module.exports = { relaxed, looseText, looseNumber, looseList, parseLooseDate, parseLooseEnum };
