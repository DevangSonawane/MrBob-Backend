const env = require('../config/env');
const { schemas, responses } = require('./components');

// The OpenAPI document served at /api-docs. Each file in ./paths documents
// one area of the API and lists its tags; the order here is the order the
// sections appear in Swagger UI. tests/apiDocs.test.js fails if a route is
// added without being documented here (or the other way round).
const sections = [
  require('./paths/customer'), // customer onboarding steps + "My account"
  require('./paths/bookings'), // service catalogue, booking flow, admin bookings, dispatch
  require('./paths/vendorOnboarding'),
  require('./paths/account'), // the customer app's and the vendor app's profile and bookings
  require('./paths/vendorJobs'), // the vendor's job flow, wallet, and the team's payouts
  require('./paths/disputes'), // help & disputes: both apps and the support team
  require('./paths/invoices'), // customer invoices for completed bookings
  require('./paths/users'), // also defines the "Super admin panel" section
  require('./paths/auth'),
  require('./paths/onboarding'),
  require('./paths/professionals'),
  require('./paths/commerce'),
  require('./paths/platform'),
];

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Home Services Platform API',
    version: '1.0.0',
    description: [
      'Backend API for the customer app, the vendor (professional) app and the admin dashboard.',
      '',
      '**Conventions**',
      '- Successful responses are `{ "success": true, "data": … }`; list endpoints return `{ "success": true, "items": […], "meta": { page, limit, total, totalPages } }`.',
      '- Errors are `{ "success": false, "message": "…", "details": … }` with a matching HTTP status.',
      '- Protected endpoints need `Authorization: Bearer <accessToken>`. Click **Authorize** and paste an access token to try them here.',
      '- Each endpoint states who may call it under **Access**. A super admin may call anything an admin may.',
      '',
      '**Customer onboarding in four steps** — phone number → verify OTP → name & gender → address. **My account** covers editing the profile, addresses and deleting the account.',
      '',
      ...(env.ONBOARDING_VALIDATION === 'strict'
        ? []
        : [
            '> **Onboarding validation is switched off on this server.** The customer and vendor onboarding endpoints accept any input: ' +
              'every field is optional and the formats and rules described below (phone, pincode, age, Aadhaar, PAN, IFSC, required images, ' +
              'file types, complete-before-submit) are not enforced; a value that cannot be stored is left out rather than refused. ' +
              'The only input check is the OTP, which must be 4 digits and correct. The rules below describe what will apply once it is switched back on.',
            '',
          ]),
      '**Customer app** and **Vendor app** — each app\'s profile (view, edit, delete) and bookings (list, detail) under `/customer/…` and `/vendor/…`.',
      '',
      '**Vendor jobs and wallet** — an approved vendor takes a job, starts and finishes it with the customer\'s codes, uploads photos and completes it (`/vendor/jobs/…`); the amount goes to their wallet (`/vendor/wallet`) and is paid out after a 2-day hold (`/payouts`).',
      '',
      '**Help & disputes** — a customer or vendor asks for help or raises a dispute (`/customer/disputes`, `/vendor/disputes`); the support team handles them under `/disputes`.',
      '',
      '**Booking flow** — service → date & time → problem description → payment, sent as one request. **Bookings (admin)** is how the team watches and manages them.',
      '',
      '**Vendor onboarding in five steps** — phone number → verify OTP → enter details → verify vendor → vendor verified.',
      '',
      '**Super admin panel** — gathers what the super admin dashboard uses: vendors by status, the final decision, and all users (list, view, edit, delete).',
    ].join('\n'),
  },
  // Relative, so "Try it out" always calls the server the docs were loaded
  // from — localhost in development, the real host once deployed.
  servers: [{ url: env.API_BASE_PATH, description: 'This server' }],
  tags: sections.flatMap((section) => section.tags),
  paths: Object.assign({}, ...sections.map((section) => section.paths)),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas,
    responses,
  },
};
