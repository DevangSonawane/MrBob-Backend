const env = require('../../config/env');

// Aadhaar/PAN verification providers.
//
// A provider takes one document and answers
//   { status: 'VERIFIED' | 'REJECTED' | 'PENDING', source, reference?, reason? }
// PENDING means "no automated answer" and leaves the document in the admin
// queue for a manual check.
//
// To plug in a real verification API: add a provider here that calls it,
// add its name to KYC_VERIFICATION_PROVIDER in config/env.js, and set that
// env var. Nothing else changes — submit() already applies whatever the
// provider returns, and manual review remains the fallback for PENDING.

const providers = {
  // No API yet: every document waits for an admin.
  manual: async () => ({ status: 'PENDING', source: 'MANUAL' }),
};

// `document` is { type, number, nameOnDocument, dateOfBirth } with the number decrypted.
const verifyDocument = (document) => providers[env.KYC_VERIFICATION_PROVIDER](document);

module.exports = { verifyDocument };
